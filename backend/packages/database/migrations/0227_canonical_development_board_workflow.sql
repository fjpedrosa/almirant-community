-- Canonicalize only `desarrollo` boards to the seven-column workflow.
-- The complete data rewrite runs inside one DO statement, which PostgreSQL
-- executes atomically. It is intentionally append-only and safe to re-run.
DO $$
DECLARE
  board_row record;
  desired record;
  target_id uuid;
  role_count integer;
BEGIN
  -- Fail closed before mutating anything. A custom/unknown Desarrollo column
  -- is safer to investigate than to silently discard.
  IF EXISTS (
    SELECT 1
    FROM board_columns bc
    JOIN boards b ON b.id = bc.board_id
    WHERE b.area = 'desarrollo'
      AND NOT (
        bc.role::text IN ('backlog', 'todo', 'in_progress', 'review', 'testing', 'needs_fix', 'validating', 'release', 'to_document', 'done')
        OR lower(trim(bc.name)) IN (
          'backlog', 'to do', 'todo', 'in progress', 'doing', 'to fix', 'needs fix',
          'needs attention', 'to review', 'reviewing', 'review', 'testing', 'test',
          'qa', 'validating', 'to release', 'release', 'to document', 'done'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Unknown column in Desarrollo board; refusing canonicalization';
  END IF;

  -- Freeze classification from the original rows; canonical roles override names.
  CREATE TEMP TABLE development_board_source (
    source_id uuid PRIMARY KEY, board_id uuid NOT NULL, source_role text NOT NULL,
    source_order integer NOT NULL, target_role text NOT NULL, force_validation_fail boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;
  INSERT INTO development_board_source SELECT bc.id, bc.board_id, bc.role::text, bc."order",
    CASE
      WHEN bc.role::text IN ('backlog', 'todo', 'in_progress', 'review', 'validating', 'release', 'done') THEN bc.role::text
      WHEN bc.role::text = 'needs_fix' OR lower(trim(bc.name)) IN ('in progress', 'doing', 'to fix', 'needs fix', 'needs attention') THEN 'in_progress'
      WHEN bc.role::text = 'testing' OR lower(trim(bc.name)) IN ('validating', 'testing', 'test', 'qa') THEN 'validating'
      WHEN bc.role::text = 'to_document' OR lower(trim(bc.name)) IN ('to release', 'release', 'to document') THEN 'release'
      WHEN lower(trim(bc.name)) = 'backlog' THEN 'backlog' WHEN lower(trim(bc.name)) IN ('to do', 'todo') THEN 'todo'
      WHEN lower(trim(bc.name)) IN ('to review', 'reviewing', 'review') THEN 'review' WHEN lower(trim(bc.name)) IN ('done', 'completed') THEN 'done'
    END,
    (bc.role::text = 'needs_fix' OR lower(trim(bc.name)) IN ('to fix', 'needs fix', 'needs attention'))
  FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.area = 'desarrollo';

  CREATE TEMP TABLE development_board_column_map (
    source_id uuid PRIMARY KEY,
    target_id uuid NOT NULL,
    force_validation_fail boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;
  CREATE TEMP TABLE development_board_targets (
    board_id uuid NOT NULL, target_role text NOT NULL, target_id uuid NOT NULL,
    name text NOT NULL, color text NOT NULL, workflow_order integer NOT NULL, is_done boolean NOT NULL, PRIMARY KEY (board_id, target_role)
  ) ON COMMIT DROP;

  FOR board_row IN
    SELECT id FROM boards WHERE area = 'desarrollo' ORDER BY id
  LOOP
    FOR desired IN
      SELECT * FROM (VALUES
        ('backlog', 'Backlog', '#94a3b8', 0, false),
        ('todo', 'To Do', '#6366f1', 1, false),
        ('in_progress', 'In Progress', '#f59e0b', 2, false),
        ('review', 'To Review', '#8b5cf6', 3, false),
        ('validating', 'Validating', '#ec4899', 4, false),
        ('release', 'To Release', '#a855f7', 5, false),
        ('done', 'Done', '#22c55e', 6, true)
      ) AS workflow(role, name, color, workflow_order, is_done)
    LOOP
      -- Prefer an existing canonical-role row. Otherwise use the first legacy
      -- row by (original order, UUID), making duplicate resolution stable.
      SELECT source.source_id INTO target_id FROM development_board_source source
      WHERE source.board_id = board_row.id AND source.target_role = desired.role
      ORDER BY CASE WHEN source.source_role = desired.role THEN 0 ELSE 2 END, source.source_order, source.source_id LIMIT 1;

      IF target_id IS NULL THEN target_id := gen_random_uuid(); END IF;
      INSERT INTO development_board_targets VALUES (board_row.id, desired.role, target_id, desired.name, desired.color, desired.workflow_order, desired.is_done);

      -- Map every duplicate/legacy source row to the selected target.
      INSERT INTO development_board_column_map (source_id, target_id, force_validation_fail)
      SELECT source.source_id, target_id, source.force_validation_fail
      FROM development_board_source source WHERE source.board_id = board_row.id AND source.target_role = desired.role
      ON CONFLICT (source_id) DO UPDATE
      SET target_id = EXCLUDED.target_id,
          force_validation_fail = development_board_column_map.force_validation_fail OR EXCLUDED.force_validation_fail;

      target_id := NULL;
    END LOOP;
  END LOOP;

  -- Classification is complete; now create and normalize the selected targets.
  UPDATE board_columns SET "order" = "order" + 1000 WHERE board_id IN (SELECT id FROM boards WHERE area = 'desarrollo');
  INSERT INTO board_columns (id, board_id, name, color, "order", role, is_done)
  SELECT target.target_id, target.board_id, target.name, target.color, target.workflow_order, target.target_role::column_role, target.is_done
  FROM development_board_targets target
  WHERE NOT EXISTS (SELECT 1 FROM board_columns bc WHERE bc.id = target.target_id);
  UPDATE board_columns bc
  SET name = target.name, color = target.color, "order" = target.workflow_order, role = target.target_role::column_role, is_done = target.is_done
  FROM development_board_targets target WHERE bc.id = target.target_id;

  -- Re-point every dependent reference before deleting duplicate/legacy rows.
  -- Deliberately omit work_items.updated_at: this is a structural repair.
  UPDATE work_items wi
  SET board_column_id = map.target_id,
      metadata = CASE WHEN map.force_validation_fail
        THEN jsonb_set(coalesce(wi.metadata, '{}'::jsonb), '{lastValidationResult}', '"fail"'::jsonb, true)
        ELSE wi.metadata END
  FROM development_board_column_map map
  WHERE wi.board_column_id = map.source_id
    AND (wi.board_column_id IS DISTINCT FROM map.target_id OR map.force_validation_fail);

  UPDATE work_item_events event
  SET old_value = map.target_id::text
  FROM development_board_column_map map
  WHERE event.field_name IN ('boardColumnId', 'board_column_id')
    AND event.old_value = map.source_id::text;

  UPDATE work_item_events event
  SET new_value = map.target_id::text
  FROM development_board_column_map map
  WHERE event.field_name IN ('boardColumnId', 'board_column_id')
    AND event.new_value = map.source_id::text;

  UPDATE work_item_events event
  SET metadata = jsonb_set(
    coalesce(event.metadata, '{}'::jsonb),
    '{boardColumnId}',
    to_jsonb(map.target_id::text),
    true
  )
  FROM development_board_column_map map
  WHERE event.metadata ->> 'boardColumnId' = map.source_id::text;

  -- targetConfig.columnIds is the only persisted scheduled-agent reference to
  -- board-column IDs. Preserve array order and leave unrelated configs intact.
  UPDATE scheduled_agent_configs config
  SET target_config = jsonb_set(
    config.target_config,
    '{columnIds}',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(coalesce(map.target_id::text, value #>> '{}')) ORDER BY ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(config.target_config -> 'columnIds') WITH ORDINALITY AS item(value, ordinality)
      LEFT JOIN development_board_column_map map ON map.source_id::text = item.value #>> '{}'
    )
  )
  WHERE jsonb_typeof(config.target_config -> 'columnIds') = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(config.target_config -> 'columnIds') AS item(value)
      JOIN development_board_column_map map ON map.source_id::text = item.value #>> '{}'
    );

  DELETE FROM board_columns bc
  USING development_board_column_map map
  WHERE bc.id = map.source_id
    AND map.source_id <> map.target_id;

  -- Normalize every built-in/custom Desarrollo template without touching other
  -- areas. JSONB is kept in the same shape consumed by create-from-template.
  UPDATE board_templates
  SET columns = jsonb_build_array(
    jsonb_build_object('name', 'Backlog', 'color', '#94a3b8', 'order', 0, 'isDone', false, 'role', 'backlog'),
    jsonb_build_object('name', 'To Do', 'color', '#6366f1', 'order', 1, 'isDone', false, 'role', 'todo'),
    jsonb_build_object('name', 'In Progress', 'color', '#f59e0b', 'order', 2, 'isDone', false, 'role', 'in_progress'),
    jsonb_build_object('name', 'To Review', 'color', '#8b5cf6', 'order', 3, 'isDone', false, 'role', 'review'),
    jsonb_build_object('name', 'Validating', 'color', '#ec4899', 'order', 4, 'isDone', false, 'role', 'validating'),
    jsonb_build_object('name', 'To Release', 'color', '#a855f7', 'order', 5, 'isDone', false, 'role', 'release'),
    jsonb_build_object('name', 'Done', 'color', '#22c55e', 'order', 6, 'isDone', true, 'role', 'done')
  )
  WHERE area = 'desarrollo';

  -- Final invariant: every Desarrollo board has exactly the seven roles and
  -- no role appears twice. Any violation aborts the whole statement.
  IF EXISTS (
    SELECT 1
    FROM boards b
    LEFT JOIN board_columns bc ON bc.board_id = b.id
    WHERE b.area = 'desarrollo'
    GROUP BY b.id
    HAVING count(*) <> 7
      OR count(*) FILTER (WHERE bc.role::text = 'backlog') <> 1
      OR count(*) FILTER (WHERE bc.role::text = 'todo') <> 1
      OR count(*) FILTER (WHERE bc.role::text = 'in_progress') <> 1
      OR count(*) FILTER (WHERE bc.role::text = 'review') <> 1
      OR count(*) FILTER (WHERE bc.role::text = 'validating') <> 1
      OR count(*) FILTER (WHERE bc.role::text = 'release') <> 1
      OR count(*) FILTER (WHERE bc.role::text = 'done') <> 1
  ) THEN
    RAISE EXCEPTION 'Desarrollo board canonicalization invariant failed';
  END IF;
END
$$;
