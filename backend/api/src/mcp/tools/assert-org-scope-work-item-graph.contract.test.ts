import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifests = new Map([
  ["backend/api/src/mcp/tools/work-items.tools.ts", "list_work_items get_work_item create_work_item create_task create_story create_feature create_epic update_work_item delete_work_item generate_work_item_prompt get_work_item_prompt move_work_item complete_review complete_definition_of_done_review upload_work_item_attachment upload_walkthrough_video get_work_item_events record_ai_session complete_ai_task get_ai_sessions complete_validation complete_validation_fail complete_documentation list_work_item_comments add_work_item_comment set_implementation_outcomes".split(" ")],
  ["backend/api/src/mcp/tools/skill-context.tools.ts", "resolve_work_items get_board_context batch_move_work_items get_dependencies_batch get_implement_context get_ideation_context get_review_context get_validate_context get_record_video_context get_document_context".split(" ")],
]);
const ROOT = resolve(import.meta.dir, "../../../../../");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const maskCode = (input: string): string => {
  let out = "", state = "code", quote = "";
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i] ?? "", n = input[i + 1] ?? "";
    if (state === "line") { out += c === "\n" ? "\n" : " "; if (c === "\n") state = "code"; continue; }
    if (state === "block") { out += c === "\n" ? "\n" : " "; if (c === "*" && n === "/") { out += " "; i += 1; state = "code"; } continue; }
    if (state === "string" || state === "template") { out += c === "\n" ? "\n" : " "; if (c === "\\") { out += n === "\n" ? "\n" : " "; i += 1; continue; } if (c === quote) state = "code"; continue; }
    if (c === "/" && n === "/") { out += "  "; i += 1; state = "line"; continue; }
    if (c === "/" && n === "*") { out += "  "; i += 1; state = "block"; continue; }
    if (["\"", "'", "`"].includes(c)) { quote = c; out += " "; state = c === "`" ? "template" : "string"; continue; }
    out += c;
  }
  return out;
};
const closeDelimiter = (masked: string, open: number, opener = "{", closer = "}") => {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) { if (masked[i] === opener) depth += 1; if (masked[i] === closer && --depth === 0) return i; }
  return -1;
};
const depthAt = (body: string, index: number) => [...body.slice(0, index)].reduce((depth, c) => depth + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
const toolRecords = (raw: string) => {
  const masked = maskCode(raw), records: Array<{ name: string; body: string }> = [];
  for (const match of masked.matchAll(/server\.tool\s*\(/gu)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const name = raw.slice(open + 1).match(/^\s*["']([^"']+)["']/u)?.[1];
    const callClose = closeDelimiter(masked, open, "(", ")");
    const handlers = callClose < 0 ? [] : [...masked.slice(open + 1, callClose).matchAll(/async\s*\(\s*params\s*,\s*extra\s*\)\s*=>\s*\{/gu)];
    if (!name || handlers.length !== 1) continue;
    const handler = handlers[0]!;
    const bodyOpen = open + 1 + handler.index + handler[0].lastIndexOf("{");
    const bodyClose = closeDelimiter(masked, bodyOpen);
    if (bodyClose >= 0) records.push({ name, body: masked.slice(bodyOpen + 1, bodyClose) });
  }
  return records;
};
const hasCanonicalImport = (raw: string) => {
  const masked = maskCode(raw);
  return [...masked.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*/gu)].some((match) => {
    const start = match.index ?? 0, end = raw.indexOf("\n", start);
    const statement = raw.slice(start, end < 0 ? raw.length : end);
    return match[1]?.includes("assertOrgScope") && /from\s*["']\.\.\/setup["']/u.test(statement);
  });
};
const handlerIsSafe = (body: string) => {
  if (/getWorkspaceIdFromExtra|extra\.authInfo|workspaceId\s*=\s*extra/gu.test(body)) return false;
  const hits = [
    /const orgResult = assertOrgScope\(extra\);/gu,
    /if \(typeof orgResult !==\s*\) return orgResult;/gu,
    /const workspaceId = orgResult;/gu,
  ].map((pattern) => [...body.matchAll(pattern)].map((match) => match.index ?? -1));
  if (hits.some((items) => items.length !== 1)) return false;
  const positions = hits.map((items) => items[0] ?? -1);
  const depths = positions.map((position) => depthAt(body, position));
  return depths.every((depth) => depth === 0) && positions[0]! < positions[1]! && positions[1]! < positions[2]!;
};
const fileIsSafe = (path: string, raw = source(path)) => {
  const expected = manifests.get(path) ?? [], records = toolRecords(raw);
  return hasCanonicalImport(raw) && records.length === expected.length
    && records.every(({ name, body }, index) => name === expected[index] && handlerIsSafe(body));
};

describe("work-item graph assertOrgScope adoption", () => {
  test("covers the exact 36 handlers in the two manifest files", () => {
    for (const [path, expected] of manifests) {
      expect(fileIsSafe(path)).toBe(true);
      expect(toolRecords(source(path)).map(({ name }) => name)).toEqual(expected);
    }
  });
  test("fails closed for guard and manifest mutations", () => {
    const path = [...manifests.keys()][0]!, valid = source(path), canonical = "const orgResult = assertOrgScope(extra);";
    const mutations = [
      valid.replace("const orgResult = assertOrgScope(extra);", "const scope = assertOrgScope(extra);"),
      valid.replace("async (params, extra) => {", "handler"),
      valid.replace("async (params, extra) => {", "() => {}"),
      valid.replace("if (typeof orgResult !== \"string\") return orgResult;", "if (typeof orgResult === \"string\") return orgResult;"),
      valid.replace("const workspaceId = orgResult;", "const workspaceId = extra.authInfo?.extra?.workspaceId;"),
      valid.replace("const orgResult = assertOrgScope(extra);", "// const orgResult = assertOrgScope(extra);"),
      valid.replace("const orgResult = assertOrgScope(extra);", 'const fake = "const orgResult = assertOrgScope(extra);";'),
      valid.replace("const orgResult = assertOrgScope(extra);", "const nested = () => { const orgResult = assertOrgScope(extra);"),
      valid.replace("const orgResult = assertOrgScope(extra);", "const orgResult = assertOrgScope(extra);\nconst orgResult = assertOrgScope(extra);"),
      valid.replace("if (typeof orgResult !== \"string\") return orgResult;", "const workspaceId = orgResult;\nif (typeof orgResult !== \"string\") return orgResult;"),
      valid.replace("if (typeof orgResult !== \"string\") return orgResult;", "if (typeof orgResult !== \"string\") return { content: [] };"),
      valid.replace("const orgResult = assertOrgScope(extra);", "function nested() { const orgResult = assertOrgScope(extra); }"),
      valid.replace(/^import \{ assertOrgScope[^\n]+$/mu, 'const fake = `import { assertOrgScope } from "../setup"`;'),
      valid.replace('server.tool(\n    "list_work_items"', ""),
      valid.replace('server.tool(\n    "get_work_item"', 'server.tool(\n    "list_work_items"'),
      valid.replace('server.tool(\n    "list_work_items"', 'server.tool(\n    "renamed_work_items"'),
      valid.replace(canonical, "").replace(canonical, `${canonical}\n${canonical}`),
      valid.replace(/const orgResult = assertOrgScope\(extra\);/u, ""),
    ];
    expect(mutations.every((candidate) => !fileIsSafe(path, candidate))).toBe(true);
  });
});
