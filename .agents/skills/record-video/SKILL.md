---
name: record-video
description: Generate a walkthrough script for a work item, request user approval via agent interaction, then record a video using Playwright. Supports iterative script refinement through an approval loop.
argument-hint: <work-item-id>
---

# Record Video Skill

You are given a **single work item ID** (e.g. `A-425`). Your job is to generate a walkthrough script describing step-by-step browser interactions, persist it in the work item metadata, request user approval (with revision loop), and upon approval record the walkthrough video using Playwright MCP.

Provider rule:

- Resolve `ACTIVE_PROVIDER` from the current client/session (`codex` -> `openai`, `claude` -> `anthropic`).
- Use `ACTIVE_PROVIDER` in all MCP calls that accept `provider`/`aiProvider`.

## Non-Negotiable Execution Order (hard-stop)

This skill has mandatory gates. Do not skip or reorder them:

1. Parse input and resolve context (`get_record_video_context`).
2. Resolve and validate target URL.
3. Initialize walkthrough metadata.
4. Generate script.
5. Request approval via interaction (loop until approved or rejected).
6. Record video with Playwright MCP.
7. Finalize metadata.

If any gate fails, report the failure clearly and stop.

## Progress Reporting (mandatory)

Report progress in natural language on their own line throughout execution:

```
- Tell the user: Resolviendo contexto del work item...
- Tell the user: URL objetivo resuelta: <url>
- Tell the user: Metadata de walkthrough inicializada
- Tell the user: Guion v<N> generado — solicitando aprobacion...
- Tell the user: Esperando respuesta del usuario (interaccion <id>)...
- Tell the user: Guion aprobado — iniciando grabacion...
- Tell the user: Grabacion completada — subiendo video...
- Final success example: Walkthrough completado para <TASK_ID>
- Warning example: <motivo parcial>
- Failure example: <motivo si falla>
```

Report success clearly on success, a warning if partially completed, an error on failure. Never skip the final outcome summary.

## Step 1: Parse Input and Resolve Context

Split `$ARGUMENTS` by whitespace to extract the work item ID. Accept the workspace work-item format (e.g. `A-425`, `A-F-125`, `MC-10`) and do not hardcode a single prefix.

If no valid ID is found, tell the user and stop.

Call:

```
get_record_video_context(workItemId: "<ID>")
```

Read the response to obtain:

- `workItem`: title, description, definition of done, type, priority, metadata
- `parentContext`: parent feature/epic details for understanding scope
- `siblings`: sibling work items for context
- `project`: project info including tech stack
- `walkthrough`: existing walkthrough metadata (if any, for resume scenarios)
- `previewUrl`: preview/staging URL for the work item
- `recordings`: existing recordings

If the work item is not found, Report: Failure summary: Work item not found and stop.

Write a marker file for token tracking:

```bash
echo '{"workItemIds":["<UUID>"],"startedAt":"<ISO_TIMESTAMP>","model":"<YOUR_MODEL_ID>","provider":"<YOUR_PROVIDER>","skill":"record-video","sessionType":"recording"}' > /tmp/mc-ai-session-marker.json
```

`Progress message — Resolviendo contexto del work item...`

## Step 2: Resolve Target URL

Determine the URL to record from, using this priority:

1. `workItem.metadata.walkthrough.targetUrl` (explicit override)
2. `previewUrl` from the context response
3. Environment variable `STAGING_URL` if available

Validate the resolved URL:

- It must not be empty. If no URL is available, Report: Failure summary: No target URL available for recording. Set a previewUrl or walkthrough.targetUrl on the work item. and stop.
- It must not be a production URL (check for patterns like `almirant.ai`, `app.almirant.ai` without `staging` or `preview` subdomain). If it is, Report: Failure summary: Cannot record against production URL: <url> and stop.

`Progress message — URL objetivo resuelta: <resolved_url>`

## Step 3: Initialize Walkthrough Metadata

Check if the work item already has walkthrough metadata with `status: 'script_approved'` or `status: 'recording'`. If so, skip to Step 6 (resume recording scenario).

Update the work item metadata to initialize the walkthrough state:

```
update_work_item(
  id: "<work_item_uuid>",
  metadata: {
    ...existingMetadata,
    walkthrough: {
      status: "script_pending",
      viewport: <from job config viewport field, or "desktop" as default>,
      targetUrl: <resolved URL>,
      scripts: <existing scripts array or []>,
      recordings: <existing recordings array or []>,
      initiatedAt: <ISO timestamp>,
      initiatedByJobId: <current job ID from context, or null>
    }
  }
)
```

Preserve any existing `scripts` and `recordings` arrays if resuming from a previous attempt.

`Progress message — Metadata de walkthrough inicializada`

## Step 4: Generate Script

Using the work item context, generate a detailed walkthrough script. The script should be a step-by-step guide for browser interactions that demonstrate the implemented feature.

### Script Generation Guidelines

Consider the following when generating the script:

- **Work item title and description**: What was built?
- **Definition of Done**: What should be demonstrated?
- **Parent feature context**: How does this fit in the bigger picture?
- **Project tech stack**: What UI framework/components are in use?

### Script Format

Generate a markdown script with this structure:

```markdown
# Walkthrough: <Work Item Title>

## Overview
<1-2 sentence summary of what this walkthrough demonstrates>

## Prerequisites
- <Any required state, e.g. "At least one board must exist">

## Steps

### Step 1: <Action Title>
- **Navigate to**: <URL path>
- **Wait for**: <Element or condition to wait for>
- **Action**: <What to do — click, type, scroll, etc.>
- **Highlight**: <What the viewer should notice>
- **Duration**: <Approximate seconds to spend on this step>

### Step 2: <Action Title>
- **Navigate to**: <URL path, if different>
- **Wait for**: <Element or condition>
- **Action**: <Interaction>
- **Highlight**: <Key observation>
- **Duration**: <seconds>

... (continue for all steps)

## Total Estimated Duration
<Sum of step durations> seconds
```

### Persist the Script

Calculate the next version number (length of existing `scripts` array + 1).

Update the work item metadata:

```
update_work_item(
  id: "<work_item_uuid>",
  metadata: {
    ...existingMetadata,
    walkthrough: {
      ...existingWalkthrough,
      status: "script_pending",
      scripts: [
        ...existingScripts,
        {
          content: "<generated script markdown>",
          generatedAt: "<ISO timestamp>",
          version: <next_version>
        }
      ],
      currentScript: {
        content: "<generated script markdown>",
        generatedAt: "<ISO timestamp>",
        version: <next_version>
      }
    }
  }
)
```

`Progress message — Guion v<version> generado — solicitando aprobacion...`

## Step 5: Request Approval via Interaction

Create an agent interaction to ask the user for approval of the generated script.

### Create Interaction

Use the MCP tool to create an interaction on the current agent job:

```
create_worker_interaction(
  jobId: "<current job ID>",
  questionType: "approval",
  question: "## Walkthrough Script v<version> for <TASK_ID>\n\n<full script content>\n\n---\n\nPlease review the walkthrough script above. You can:\n- **Approve** to proceed with recording\n- **Request changes** with specific feedback\n- **Reject** to cancel the recording",
  options: ["approve", "request_changes", "reject"],
  timeoutAction: "fail",
  expiresInMinutes: 30
)
```

### Poll for Response

`Progress message — Esperando respuesta del usuario (interaccion <interaction_id>)...`

Poll the interaction status periodically (every 5 seconds) until it is answered, timed out, or cancelled:

```
get_worker_interaction(interactionId: "<interaction_id>")
```

Check the `status` field:

- `"pending"` -> continue polling
- `"answered"` -> read `response` field and proceed
- `"timed_out"` -> Report: Failure summary: Interaction timed out waiting for approval and stop
- `"cancelled"` -> Report: Failure summary: Interaction cancelled and stop

### Handle Response

#### If response is "approve"

Update the script metadata:

```
update_work_item(
  id: "<work_item_uuid>",
  metadata: {
    ...existingMetadata,
    walkthrough: {
      ...existingWalkthrough,
      status: "script_approved",
      currentScript: {
        ...currentScript,
        approvedAt: "<ISO timestamp>"
      }
    }
  }
)
```

`Progress message — Guion aprobado — iniciando grabacion...`

Proceed to Step 6.

#### If response is "request_changes"

Read the user's feedback from the interaction response text.

Update the current script with rejection info:

```
walkthrough.currentScript.rejectedAt = "<ISO timestamp>"
walkthrough.currentScript.rejectionReason = "<user feedback>"
```

Then go back to **Step 4** to regenerate the script, incorporating the user's feedback. The new script should address the specific changes requested while maintaining the overall structure.

**Important**: There is no hard limit on revision rounds, but after 5 revisions, add a a warning note about the high revision count.

#### If response is "reject"

Update metadata:

```
update_work_item(
  id: "<work_item_uuid>",
  metadata: {
    ...existingMetadata,
    walkthrough: {
      ...existingWalkthrough,
      status: "failed",
      currentScript: {
        ...currentScript,
        rejectedAt: "<ISO timestamp>",
        rejectionReason: "<user feedback or 'Rejected by user'>"
      }
    }
  }
)
```

Report: Failure summary: Walkthrough script rejected by user and stop.

## Step 6: Record Video

After script approval, execute the walkthrough using Playwright MCP browser automation.

### 6a. Update Status

```
update_work_item(
  id: "<work_item_uuid>",
  metadata: {
    ...existingMetadata,
    walkthrough: {
      ...existingWalkthrough,
      status: "recording"
    }
  }
)
```

### 6b. Configure Browser

Determine viewport based on `walkthrough.viewport`:

- `desktop`: 1280x720
- `mobile`: 375x812

### 6c. Start Recording Session

Use Playwright MCP to start a video recording context:

```
browser_start_video_recording(
  options: {
    width: <viewport_width>,
    height: <viewport_height>
  }
)
```

### 6d. Inject Cursor / Touch Overlay

Playwright's CDP-based interactions do not render a visible cursor in the recorded video. To make interactions visible, inject an overlay script immediately after the first navigation:

1. Read `services/runner/src/lib/recording-overlays.ts` to obtain the overlay scripts.
2. Choose the script based on `walkthrough.viewport`:
   - `desktop` -> use `CURSOR_OVERLAY_SCRIPT` (red tracking dot that pulses on click)
   - `mobile` -> use `TOUCH_OVERLAY_SCRIPT` (expanding blue ripple on each tap/click)
3. Inject the chosen script using `browser_evaluate`:

   ```
   browser_evaluate(script: "<overlay script content>")
   ```

4. **Re-inject after every navigation.** The overlay lives in the page DOM, so any `browser_navigate` call will destroy it. After each navigation step, re-run `browser_evaluate` with the same overlay script.

> **Note:** The overlay element uses `pointer-events: none` and `z-index: 999999`, so it will not interfere with click targets or page layout. Both scripts include a guard to prevent duplicate injection.

### 6e. Execute Script Steps

For each step in the approved script, execute the corresponding Playwright actions:

1. **Navigate**: `browser_navigate(url: "<targetUrl><path>")`
2. **Re-inject overlay**: `browser_evaluate(script: "<overlay script>")` (required after every navigation)
3. **Wait**: `browser_wait_for(selector: "<element>")` or use a reasonable delay
4. **Interact**: Use the appropriate Playwright action:
   - `browser_click(selector: "<element>")` for clicks
   - `browser_type(selector: "<element>", text: "<text>")` for text input
   - `browser_scroll(direction: "down", amount: <pixels>)` for scrolling
5. **Pause**: Add natural pacing between steps (1-3 seconds) to make the video watchable
6. **Screenshot**: Optionally `browser_take_screenshot()` at key moments for verification

If a step fails (element not found, navigation error):

- Log a a warning with the step details
- Try to continue with the next step
- If more than half the steps fail, Report: Failure summary: Too many steps failed during recording and set status to `failed`

### 6f. Stop Recording

Close the browser context to finalize the video:

```
browser_close()
```

The video file will be saved by Playwright. Locate the recording file.

### 6g. Upload Video

Upload the recording as a work item attachment:

```
upload_work_item_attachment(
  workItemId: "<work_item_uuid>",
  filePath: "<path to video file>",
  fileName: "walkthrough-<TASK_ID>-v<version>-<viewport>.webm",
  metadata: {
    kind: "walkthrough",
    viewport: "<viewport>",
    scriptVersion: <version>
  },
  deleteAfterUpload: true
)
```

### 6h. Update Recording Metadata

Create a `WalkthroughRecording` entry:

```
update_work_item(
  id: "<work_item_uuid>",
  metadata: {
    ...existingMetadata,
    walkthrough: {
      ...existingWalkthrough,
      recordings: [
        ...existingRecordings,
        {
          id: "<generated UUID>",
          viewport: "<viewport>",
          attachmentId: "<from upload response>",
          attachmentUrl: "<from upload response>",
          duration: <estimated from script>,
          recordedAt: "<ISO timestamp>",
          jobId: "<current job ID>"
        }
      ]
    }
  }
)
```

`Progress message — Grabacion completada — subiendo video...`

## Step 7: Finalize

Update the walkthrough status to completed:

```
update_work_item(
  id: "<work_item_uuid>",
  metadata: {
    ...existingMetadata,
    walkthrough: {
      ...existingWalkthrough,
      status: "completed",
      completedAt: "<ISO timestamp>"
    }
  }
)
```

### Summary Report

```
## Recording Summary

**Work Item**: <TASK_ID> - "<Title>"
**Target URL**: <resolved URL>
**Viewport**: <viewport>
**Script Version**: v<version> (approved)
**Video**: <attachment filename>
**Duration**: ~<estimated> seconds

### Script Revision History
| Version | Generated | Status |
|---------|-----------|--------|
| v1      | <timestamp> | <approved/rejected> |
| v2      | <timestamp> | <approved/rejected> |

### Next Steps
- [ ] Review the recorded video in the work item attachments
- [ ] Re-run with different viewport if needed (mobile/desktop)
```

`Success message — Walkthrough completado para <TASK_ID>`

## Error Handling

### No target URL

If no preview URL or target URL is available, report an error with instructions to set one on the work item and stop.

### Production URL detected

Refuse to record against production URLs. Report the failure clearly and stop.

### Interaction timeout

If the approval interaction times out (30 minutes), the job fails with an error. The script remains persisted in metadata, so the user can re-trigger the skill to resume.

### Playwright MCP unavailable

If Playwright browser tools are not available, Report: Failure summary: Playwright MCP is not available. Cannot record video. and stop. Unlike other skills, this skill cannot proceed without browser automation.

### Recording step failures

If individual script steps fail during recording:

- Log each failure as a warning
- Continue with remaining steps if possible
- If >50% of steps fail, abort and set status to `failed`

### Resumability

All state is persisted in work item metadata. The skill can be re-triggered and will:

- Resume from `script_approved` status directly to recording
- Resume from `script_pending` with existing scripts, presenting the latest for approval
- Start fresh if no walkthrough metadata exists

### Token tracking

Write session marker at start. On completion, the runner infrastructure handles AI session recording automatically.
