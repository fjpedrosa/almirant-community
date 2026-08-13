import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../../../");
const path = "backend/api/src/mcp/tools/seeds.tools.ts";
const names = "list_seeds get_seed create_seed update_seed delete_seed set_seed_status get_seeds_for_ideation mark_seeds_as_used promote_seed add_tag_to_seed remove_tag_from_seed list_seed_tags list_seed_comments add_seed_comment".split(" ");
const read = (raw = readFileSync(resolve(root, path), "utf8")) => raw;
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
const close = (text: string, open: number, opener = "{", closer = "}") => { let d = 0; for (let i = open; i < text.length; i += 1) { if (text[i] === opener) d += 1; if (text[i] === closer && --d === 0) return i; } return -1; };
const depth = (text: string, index: number) => [...text.slice(0, index)].reduce((d, c) => d + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
const records = (raw: string) => {
  const clean = mask(raw), found: Array<{ name: string; body: string }> = [];
  for (const hit of clean.matchAll(/server\.tool\s*\(/gu)) {
    const open = (hit.index ?? 0) + hit[0].length - 1, name = raw.slice(open + 1).match(/^\s*["']([^"']+)["']/u)?.[1], end = close(clean, open, "(", ")");
    const callbacks = end < 0 ? [] : [...clean.slice(open + 1, end).matchAll(/async\s*\(\s*params\s*,\s*extra\s*\)\s*=>\s*\{/gu)];
    if (!name || callbacks.length !== 1) continue;
    const bodyOpen = open + 1 + callbacks[0]!.index + callbacks[0]![0].lastIndexOf("{"), bodyClose = close(clean, bodyOpen);
    if (bodyClose >= 0) found.push({ name, body: clean.slice(bodyOpen + 1, bodyClose) });
  }
  return found;
};
const importIsCanonical = (raw: string) => {
  const clean = mask(raw), imports = [...clean.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*/gu)];
  return imports.some((hit) => {
    const start = hit.index ?? 0, end = raw.indexOf(";", start), statement = raw.slice(start, end < 0 ? raw.length : end);
    const specifiers = hit[1]!.split(",").map((item) => item.trim());
    return /["']\.\.\/setup["']/u.test(statement) && specifiers.filter((item) => item === "assertOrgScope").length === 1 && !/\bassertOrgScope\s+as\b/u.test(hit[1]!);
  }) && !/(?:const|let|var|function|class)\s+assertOrgScope\b/u.test(clean);
};
const bodyIsCanonical = (body: string) => {
  if (/getWorkspaceIdFromExtra|extra\.authInfo|(?:const|let|var|function|class)\s+assertOrgScope\b/u.test(body)) return false;
  const call = body.indexOf("const workspaceId = assertOrgScope(extra);");
  const guard = /if \(typeof workspaceId !==\s*\) return workspaceId;/u.exec(body)?.index ?? -1;
  const attempt = body.indexOf("try {");
  return call >= 0 && guard > call && attempt > guard && body.indexOf("const workspaceId = assertOrgScope(extra);", call + 1) < 0 && depth(body, call) === 0 && depth(body, guard) === 0;
};
const safe = (raw = read()) => {
  const found = records(raw);
  return importIsCanonical(raw) && found.length === names.length && found.every(({ name, body }, index) => name === names[index] && bodyIsCanonical(body));
};

describe("seeds-only assertOrgScope adoption", () => {
  test("covers the exact 14 handlers in manifest order", () => { expect(safe()).toBe(true); expect(records(read()).map(({ name }) => name)).toEqual(names); });
  test("fails closed for import, guard, callback, and manifest mutations", () => {
    const valid = read(), guard = "const workspaceId = assertOrgScope(extra);";
    const mutations = [
      valid.replace("  assertOrgScope,\n", "  assertOrgScope as canonicalAssertOrgScope,\n"),
      valid.replace("  assertOrgScope,\n", "  assertOrgScope as canonicalAssertOrgScope,\n").replace("const SEED_STATUS_SCHEMA", "const assertOrgScope = () => \"fake\";\nconst SEED_STATUS_SCHEMA"),
      valid.replace("  assertOrgScope,\n", "").replace("const SEED_STATUS_SCHEMA", "const fakeImport = \"import { assertOrgScope } from '../setup'\";\nconst assertOrgScope = () => \"fake\";\nconst SEED_STATUS_SCHEMA"),
      valid.replace("  assertOrgScope,\n", "").replace("const SEED_STATUS_SCHEMA", "// import { assertOrgScope } from '../setup'\nconst assertOrgScope = () => \"fake\";\nconst SEED_STATUS_SCHEMA"),
      valid.replace("  assertOrgScope,\n", "").replace("const SEED_STATUS_SCHEMA", "const fakeImport = `import { assertOrgScope } from '../setup'`;\nconst assertOrgScope = () => \"fake\";\nconst SEED_STATUS_SCHEMA"),
      valid.replace("  assertOrgScope,\n", "  canonicalAssertOrgScope,\n"),
      valid.replace("  assertOrgScope,\n", "  assertOrgScope,\n  assertOrgScope,\n"),
      valid.replace('server.tool(\n    "get_seed"', 'server.tool(\n    "list_seeds"'),
      valid.replace(guard, "const scope = assertOrgScope(extra);"),
      valid.replace(guard, `${guard}\n${guard}`),
      valid.replace("if (typeof workspaceId !== \"string\") return workspaceId;", "if (typeof workspaceId === \"string\") return workspaceId;"),
      valid.replace("if (typeof workspaceId !== \"string\") return workspaceId;", "const workspaceId = assertOrgScope(extra);"),
      valid.replace("if (typeof workspaceId !== \"string\") return workspaceId;", "if (typeof workspaceId !== \"string\") return { content: [] };"),
      valid.replace("const workspaceId = assertOrgScope(extra);", "const workspaceId = extra.authInfo?.extra?.workspaceId;"),
      valid.replace("assertOrgScope(extra)", '"assertOrgScope(extra)"'),
      valid.replace("async (params, extra) => {", "handler"),
      valid.replace("async (params, extra) => {", "async (params, extra) => other"),
      valid.replace("async (params, extra) => {", "() => {}"),
      valid.replace('server.tool(\n    "list_seeds"', ""),
      valid.replace('server.tool(\n    "list_seeds"', 'server.tool(\n    "renamed_seeds"'),
      valid.replace(guard, "function nested() { const workspaceId = assertOrgScope(extra); }"),
      valid.replace("const workspaceId = assertOrgScope(extra);", "const fake = `const workspaceId = assertOrgScope(extra);`;")
    ];
    expect(mutations.every((candidate) => !safe(candidate))).toBe(true);
  });
});
