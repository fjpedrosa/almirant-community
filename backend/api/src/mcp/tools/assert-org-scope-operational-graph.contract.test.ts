import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../../../");
const manifests = ([
  ["backend/api/src/mcp/tools/dependencies.tools.ts", "get_work_item_dependencies add_work_item_dependency remove_work_item_dependency"],
  ["backend/api/src/mcp/tools/members.tools.ts", "list_members"],
  ["backend/api/src/mcp/tools/commits.tools.ts", "link_commit_to_work_item"],
  ["backend/api/src/mcp/tools/expenses.tools.ts", "list_expenses get_expense create_expense get_expense_summary list_expense_categories list_recurring_expenses"],
  ["backend/api/src/mcp/tools/milestones.tools.ts", "list_milestones get_milestone get_milestone_progress create_milestone update_milestone delete_milestone add_work_items_to_milestone remove_work_item_from_milestone"],
  ["backend/api/src/mcp/tools/quota.tools.ts", "check_quota get_quota_usage"],
] as const).map(([path, names]) => ({ path, names: names.split(" ") }));
const read = (path: string, raw?: string) => raw ?? readFileSync(resolve(root, path), "utf8");
const mask = (input: string) => {
  let out = "", state = "code", quote = "";
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i] ?? "", n = input[i + 1] ?? "";
    if (state === "line") { out += c === "\n" ? "\n" : " "; if (c === "\n") state = "code"; continue; }
    if (state === "block") { out += c === "\n" ? "\n" : " "; if (c === "*" && n === "/") { out += " "; i += 1; state = "code"; } continue; }
    if (state !== "code") { out += c === "\n" ? "\n" : " "; if (c === "\\") { out += n === "\n" ? "\n" : " "; i += 1; continue; } if (c === quote) state = "code"; continue; }
    if (c === "/" && n === "/") { out += "  "; i += 1; state = "line"; continue; }
    if (c === "/" && n === "*") { out += "  "; i += 1; state = "block"; continue; }
    if (["\"", "'", "`"].includes(c)) { quote = c; out += " "; state = "string"; continue; }
    out += c;
  }
  return out;
};
const close = (text: string, open: number, opener = "{", closer = "}") => { let depth = 0; for (let i = open; i < text.length; i += 1) { if (text[i] === opener) depth += 1; if (text[i] === closer && --depth === 0) return i; } return -1; };
const braceDepth = (text: string, index: number) => [...text.slice(0, index)].reduce((depth, c) => depth + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
const records = (raw: string) => {
  const clean = mask(raw), found: Array<{ name: string; body: string }> = [];
  for (const hit of clean.matchAll(/server\.tool\s*\(/gu)) {
    const open = (hit.index ?? 0) + hit[0].length - 1, end = close(clean, open, "(", ")"), name = raw.slice(open + 1).match(/^\s*["']([^"']+)["']/u)?.[1];
    const callbacks = end < 0 ? [] : [...clean.slice(open + 1, end).matchAll(/async\s*\(\s*(?:params|_params)\s*,\s*extra\s*\)\s*=>\s*\{/gu)];
    if (!name || callbacks.length !== 1) continue;
    const bodyOpen = open + 1 + callbacks[0]!.index + callbacks[0]![0].lastIndexOf("{"), bodyClose = close(clean, bodyOpen);
    if (bodyClose >= 0) found.push({ name, body: clean.slice(bodyOpen + 1, bodyClose) });
  }
  return found;
};
const importIsCanonical = (raw: string) => {
  const clean = mask(raw), imports = [...clean.matchAll(/\bimport\s*\{([^}]*)\}\s*from\b/gu)];
  return imports.some((hit) => {
    const start = hit.index ?? 0, fromEnd = start + hit[0].length, whitespace = raw.slice(fromEnd).match(/^\s*/u)?.[0].length ?? 0, moduleStart = fromEnd + whitespace, modulePath = raw.slice(moduleStart).match(/^(?:"\.\.\/setup"|'\.\.\/setup')/u), specs = hit[1]!.split(",").map((item) => item.trim());
    return Boolean(modulePath) && specs.filter((item) => item === "assertOrgScope").length === 1 && !/\bassertOrgScope\s+as\b/u.test(hit[1]!);
  }) && !/(?:const|let|var|function|class)\s+assertOrgScope\b/u.test(clean);
};
const bodyIsCanonical = (body: string) => {
  if (/getWorkspaceIdFromExtra|extra\.authInfo|extra\.workspaceId|(?:const|let|var|function|class)\s+assertOrgScope\b/u.test(body)) return false;
  const call = body.indexOf("const workspaceId = assertOrgScope(extra);");
  const guard = /if \(typeof workspaceId !==\s*\) return workspaceId;/u.exec(body)?.index ?? -1, attempt = body.indexOf("try {");
  return call >= 0 && guard > call && attempt > guard && body.indexOf("const workspaceId = assertOrgScope(extra);", call + 1) < 0 && braceDepth(body, call) === 0 && braceDepth(body, guard) === 0;
};
const safe = (entry: (typeof manifests)[number], raw = read(entry.path)) => {
  const found = records(raw);
  return importIsCanonical(raw) && found.length === entry.names.length && found.every(({ name, body }, index) => name === entry.names[index] && bodyIsCanonical(body));
};

describe("operational graph assertOrgScope adoption", () => {
  test("covers exact handlers in manifest order", () => { expect(manifests.every((entry) => safe(entry))).toBe(true); expect(manifests.flatMap((entry) => entry.names)).toHaveLength(21); });
  test("fails closed for import, callback, guard, and manifest mutations", () => {
    const entry = manifests[0]!, valid = read(entry.path), guard = "const workspaceId = assertOrgScope(extra);", mutate = (next: string) => safe(entry, next);
    const mutations = [
      valid.replace("import { assertOrgScope }", "import { assertOrgScope as canonicalAssertOrgScope }").replace("const workspaceId", "const assertOrgScope = () => \"fake\";\nconst workspaceId"),
      valid.replace('from "../setup";', 'from "./scope-decoy" /* "../setup" */;'),
      valid.replace("import { assertOrgScope } from \"../setup\";", "").replace("import {", "// import { assertOrgScope } from '../setup'\nimport {").replace("const workspaceId", "const fake = `assertOrgScope`; const assertOrgScope = () => \"fake\";\nconst workspaceId"),
      valid.replace("import { assertOrgScope }", "import { assertOrgScope, assertOrgScope }"), valid.replace(guard, "const scope = assertOrgScope(extra);"), valid.replace(guard, `${guard}\n${guard}`),
      valid.replace("if (typeof workspaceId !== \"string\") return workspaceId;", "if (typeof workspaceId === \"string\") return workspaceId;"), valid.replace("if (typeof workspaceId !== \"string\") return workspaceId;", "if (typeof workspaceId !== \"string\") return { content: [] };"),
      valid.replace("const workspaceId = assertOrgScope(extra);", "const workspaceId = extra.authInfo?.extra?.workspaceId;"), valid.replace("async (params, extra) => {", "async (params, extra) => other"), valid.replace("async (params, extra) => {", "handler"),
      valid.replace('server.tool(\n    "add_work_item_dependency"', 'server.tool(\n    "get_work_item_dependencies"'), valid.replace('server.tool(\n    "get_work_item_dependencies"', ""), valid.replace('server.tool(\n    "get_work_item_dependencies"', 'server.tool(\n    "renamed_dependency"'),
      valid.replace(guard, "function nested() { const workspaceId = assertOrgScope(extra); }")
    ];
    expect(mutations.every((candidate) => !mutate(candidate))).toBe(true);
  });
});
