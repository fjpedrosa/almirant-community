import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./integration-batches.tools.ts", import.meta.url), "utf8");
const guardNames = ["requireOrgScope", "requireOrgScopeForItem"];
const stripComments = (value: string) => value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
const stripLiterals = (value: string) => value.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/gu, (literal, quote: string, offset: number, whole: string) =>
  /\b(?:from|import\s*\()\s*$/.test(whole.slice(0, offset)) ? literal : `${quote}${quote}`);
const depthAt = (value: string, index: number) => [...value.slice(0, index)].reduce((depth, char) => depth + (char === "{" ? 1 : char === "}" ? -1 : 0), 0);
const guardBody = (clean: string, name: string) => {
  const start = clean.indexOf(`const ${name} = async`);
  const open = clean.indexOf("{", clean.indexOf("=>", start));
  if (start < 0 || open < 0) return "";
  let depth = 0;
  for (let i = open; i < clean.length; i += 1) {
    if (clean[i] === "{") depth += 1;
    if (clean[i] === "}" && --depth === 0) return clean.slice(open, i);
  }
  return "";
};
const inspect = (candidate: string) => {
  const comments = stripComments(candidate);
  const clean = stripLiterals(comments);
  const specifiers = clean.match(/(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*["']\.\.\/setup["']/s)?.[1]?.split(",").map((item) => item.trim()) ?? [];
  const importOk = specifiers.includes("assertOrgScope") && specifiers.includes("type McpToolResult");
  const guardsOk = guardNames.every((name) => {
    const body = guardBody(clean, name);
    const sequence = [
      /const orgResult = assertOrgScope\(extra\);/u,
      /if \(typeof orgResult !== ""\) return \{ ok: false, result: orgResult \};/u,
      /const workspaceId = orgResult;/u,
    ].map((pattern) => [...body.matchAll(new RegExp(pattern.source, "gu"))].find((match) => depthAt(body, match.index!) === 1)?.index ?? -1);
    return sequence.every((position, index) => position >= 0 && (index === 0 || position > sequence[index - 1]!)) &&
      !/\bfunction\s+\w+\s*\(|=>/u.test(body) && !/getWorkspaceIdFromExtra|(?:orgResult|workspaceId)\s*=\s*extra(?:\.|\?\.|\[)/u.test(body);
  });
  return importOk && guardsOk && clean.match(/assertOrgScope\(extra\)/g)?.length === 2;
};

describe("integration-batches assertOrgScope adoption", () => {
  it("binds one real canonical guard to each batch scope", () => expect(inspect(source)).toBe(true));

  it("rejects comments, strings, relocation, and manual extraction decoys", () => {
    const valid = `import { type McpToolResult, assertOrgScope } from "../setup";
const requireOrgScope = async () => {
 const orgResult = assertOrgScope(extra);
 if (typeof orgResult !== "string") return { ok: false, result: orgResult };
 const workspaceId = orgResult;
};
const requireOrgScopeForItem = async () => {
 const orgResult = assertOrgScope(extra);
 if (typeof orgResult !== "string") return { ok: false, result: orgResult };
 const workspaceId = orgResult;
};`;
    const decoys = [
      valid.replace(/const orgResult = assertOrgScope\(extra\);/g, "// const orgResult = assertOrgScope(extra);"),
      valid.replace(/const orgResult = assertOrgScope\(extra\);/g, 'const fake = "const orgResult = assertOrgScope(extra);";'),
      valid.replace(/const requireOrgScopeForItem = async[\s\S]*/, "const requireOrgScopeForItem = async () => {};"),
      valid.replace(/const workspaceId = orgResult;/g, "const workspaceId = extra.authInfo?.extra?.workspaceId;"),
      valid.replace(/const orgResult = assertOrgScope\(extra\);/g, "const scope = assertOrgScope(extra);"),
      valid.replace(/const requireOrgScope = async \(\) => \{[\s\S]*?\n\};/, "const requireOrgScope = async () => { const inline = () => { const orgResult = assertOrgScope(extra); if (typeof orgResult !== \\\"string\\\") return { ok: false, result: orgResult }; const workspaceId = orgResult; }; };"),
      `const decoy = \`${valid}\`;`,
      valid.replace(/^import[^\n]+\n/u, "const template = `\nimport { type McpToolResult, assertOrgScope } from \\\"../setup\\\";\n`;\n"),
      valid.replace(/const requireOrgScope = async \(\) => \{[\s\S]*?\n\};/u, (body) => `const requireOrgScope = async () => { function nested() { ${body.slice(body.indexOf("{") + 1, -2)} } };`),
    ];
    expect(inspect(valid)).toBe(true);
    expect(decoys.every((candidate) => !inspect(candidate))).toBe(true);
  });
});
