export interface SqlSource { readonly path: string; readonly source: string }
export type DescribeSql = (statement: string) => Promise<void> | void;

type Token = { readonly kind: "word" | "string" | "symbol"; readonly text: string; readonly quoted?: boolean };
type Statement = { readonly sql: string; readonly tokens: readonly Token[] };
type Value = { readonly constant?: string; readonly lineage: boolean; readonly dropTemplate?: boolean };

const wordStart = /[A-Za-z_\u0080-\uFFFF]/;
const wordPart = /[A-Za-z\d_$\u0080-\uFFFF]/;
const protectedName = /(^|[^A-Za-z\d_$])(?:currency_rates|currency_code|currency_rates_pair_date_idx)(?=$|[^A-Za-z\d_$])/i;
const lineage = (text: string) => protectedName.test(text);
const keyword = (token: Token | undefined, text: string) => token?.kind === "word" && !token.quoted && token.text === text;
const escapeAt = (source: string, index: number, unicode: boolean) => {
  const match = source.slice(index).match(unicode ? /^\\(?:\+([0-9a-f]{6})|([0-9a-f]{4})|(\\))/i : /^\\(?:([0-7]{1,3})|x([0-9a-f]{1,2})|u([0-9a-f]{4})|U([0-9a-f]{8})|([\s\S]))/);
  if (!match) return;
  const digits = unicode ? match[1] ?? match[2] : match[1] ?? match[2] ?? match[3] ?? match[4];
  if (digits) {
    try { return { text: String.fromCodePoint(Number.parseInt(digits, !unicode && match[1] ? 8 : 16)), next: index + match[0].length }; }
    catch { return; }
  }
  const character = match.at(-1)!;
  return { text: unicode ? character : ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[character] ?? character), next: index + match[0].length };
};
const decodeUnicode = (source: string, escape: string) => {
  let value = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "'" && source[index + 1] === "'") { value += "'"; index += 2; continue; }
    if (source[index] !== escape) { value += source[index++]!; continue; }
    if (source[index + 1] === escape) { value += escape; index += 2; continue; }
    const plus = source[index + 1] === "+", length = plus ? 6 : 4, start = index + (plus ? 2 : 1), digits = source.slice(start, start + length);
    if (digits.length !== length || !/^[0-9a-f]+$/i.test(digits)) return;
    try { value += String.fromCodePoint(Number.parseInt(digits, 16)); } catch { return; }
    index = start + length;
  }
  return value;
};

const parseSql = (source: string): readonly Statement[] | undefined => {
  if (source.length > 8_388_608) return;
  const statements: Statement[] = [];
  let tokens: Token[] = [], start = 0;
  const finish = (end: number) => {
    if (tokens.length) statements.push({ sql: source.slice(start, end), tokens });
    tokens = []; start = end + 1;
  };
  for (let index = 0; index < source.length;) {
    if (tokens.length > 100_000) return;
    const character = source[index]!, next = source[index + 1];
    if (/\s/.test(character)) { index++; continue; }
    if (character === "-" && next === "-") {
      index += 2; while (index < source.length && !/\r|\n/.test(source[index]!)) index++; continue;
    }
    if (character === "/" && next === "*") {
      let depth = 1; index += 2;
      while (index < source.length && depth) {
        if (source[index] === "/" && source[index + 1] === "*") { depth++; index += 2; }
        else if (source[index] === "*" && source[index + 1] === "/") { depth--; index += 2; }
        else index++;
      }
      if (depth) return; continue;
    }
    const escapePrefix = (character === "E" || character === "e") && next === "'" && !wordPart.test(source[index - 1] ?? "");
    const unicodePrefix = (character === "U" || character === "u") && next === "&" && source[index + 2] === "'" && !wordPart.test(source[index - 1] ?? "");
    if (character === "'" || escapePrefix || unicodePrefix) {
      const escaped = escapePrefix || unicodePrefix;
      index += unicodePrefix ? 3 : escapePrefix ? 2 : 1;
      const contentStart = index; let value = "", closed = false, contentEnd = index;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") { value += "'"; index += 2; }
        else if (source[index] === "'") { contentEnd = index; index++; closed = true; break; }
        else if (escaped && source[index] === "\\") { const escape = escapeAt(source, index, unicodePrefix); if (!escape) return; value += escape.text; index = escape.next; }
        else value += source[index++]!;
      }
      if (!closed) return;
      const clause = unicodePrefix ? source.slice(index).match(/^\s+uescape\s+'(.)'/i) : undefined;
      if (clause) { const cooked = decodeUnicode(source.slice(contentStart, contentEnd), clause[1]!); if (cooked === undefined) return; value = cooked; index += clause[0].length; }
      tokens.push({ kind: "string", text: value }); continue;
    }
    if (character === '"') {
      index++; let value = "", closed = false;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') { value += '"'; index += 2; }
        else if (source[index] === '"') { index++; closed = true; break; }
        else value += source[index++]!;
      }
      if (!closed) return; tokens.push({ kind: "word", text: value, quoted: true }); continue;
    }
    if (character === "$") {
      const delimiter = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z\d_]*)?\$/)?.[0];
      if (delimiter) {
        const end = source.indexOf(delimiter, index + delimiter.length);
        if (end < 0) return;
        tokens.push({ kind: "string", text: source.slice(index + delimiter.length, end) });
        index = end + delimiter.length; continue;
      }
    }
    if (wordStart.test(character)) {
      let end = index + 1; while (end < source.length && wordPart.test(source[end]!)) end++;
      tokens.push({ kind: "word", text: source.slice(index, end).toLowerCase() }); index = end; continue;
    }
    const pair = source.slice(index, index + 2);
    if (pair === "||" || pair === ":=") { tokens.push({ kind: "symbol", text: pair }); index += 2; continue; }
    if (character === ";") { finish(index); index++; continue; }
    tokens.push({ kind: "symbol", text: character }); index++;
  }
  finish(source.length); return statements;
};

const objectAt = (tokens: readonly Token[], index: number, expected: string) => {
  while (["concurrently", "if", "exists", "only"].some((word) => keyword(tokens[index], word))) index++;
  const parts: string[] = [];
  if (tokens[index]?.kind === "word") parts.push(tokens[index++]!.text);
  while (tokens[index]?.text === "." && tokens[index + 1]?.kind === "word") { parts.push(tokens[index + 1]!.text); index += 2; }
  return { matches: (parts.length === 1 || parts.length === 2 && parts[0] === "public") && parts.at(-1) === expected, next: index };
};

const destructiveDdl = (tokens: readonly Token[]) => {
  const protectedByKind: Record<string, string> = { table: "currency_rates", type: "currency_code", index: "currency_rates_pair_date_idx" };
  for (let index = 0; index + 1 < tokens.length; index++) {
    if (keyword(tokens[index], "drop") && tokens[index + 1]?.kind === "word" && !tokens[index + 1]?.quoted && protectedByKind[tokens[index + 1]!.text]) {
      const expected = protectedByKind[tokens[index + 1]!.text]!; let cursor = index + 2;
      do { const target = objectAt(tokens, cursor, expected); if (target.matches) return true; cursor = target.next; if (tokens[cursor]?.text !== ",") break; cursor++; } while (cursor < tokens.length);
    }
    if (keyword(tokens[index], "alter") && keyword(tokens[index + 1], "table")) {
      const target = objectAt(tokens, index + 2, "currency_rates");
      if (target.matches && tokens.slice(target.next).some((token, offset, rest) => keyword(token, "drop") && keyword(rest[offset + 1], "column"))) return true;
    }
  }
  return false;
};

const visibleLineage = (tokens: readonly Token[]) => {
  const protectedByKind: Record<string, string> = { table: "currency_rates", type: "currency_code", index: "currency_rates_pair_date_idx" };
  const trigger = tokens.some((token) => keyword(token, "trigger")), columnDefinition = keyword(tokens[0], "create") && keyword(tokens[1], "table") || tokens.some((token, offset) => keyword(token, "add") && keyword(tokens[offset + 1], "column"));
  for (let index = 0; index < tokens.length; index++) {
    const expected = tokens[index]?.kind === "word" && !tokens[index]?.quoted ? protectedByKind[tokens[index]!.text] : undefined;
    if (expected && objectAt(tokens, index + 1, expected).matches) return true;
    if (["from", "join", "update", "references"].some((word) => keyword(tokens[index], word)) && objectAt(tokens, index + 1, "currency_rates").matches) return true;
    if (keyword(tokens[index], "into") && keyword(tokens[0], "insert") && objectAt(tokens, index + 1, "currency_rates").matches) return true;
    if (keyword(tokens[index], "on") && trigger && objectAt(tokens, index + 1, "currency_rates").matches) return true;
    if (columnDefinition && tokens[index - 1]?.kind === "word" && !keyword(tokens[index - 1], "table") && objectAt(tokens, index, "currency_code").matches) return true;
  }
  return false;
};

const splitAt = (tokens: readonly Token[], separator: string) => {
  const parts: Token[][] = [[]]; let depth = 0;
  for (const token of tokens) {
    if (token.text === "(") depth++;
    if (token.text === ")") depth--;
    if (!depth && token.text === separator) parts.push([]); else parts.at(-1)!.push(token);
  }
  return parts;
};

const evaluate = (tokens: readonly Token[], variables: ReadonlyMap<string, Value>): Value => {
  while (tokens[0]?.text === "(" && tokens.at(-1)?.text === ")") tokens = tokens.slice(1, -1);
  const concatenated = splitAt(tokens, "||");
  if (concatenated.length > 1) {
    const values = concatenated.map((part) => evaluate(part, variables));
    return { constant: values.every(({ constant }) => constant !== undefined) ? values.map(({ constant }) => constant).join("") : undefined, lineage: values.some((value) => value.lineage), dropTemplate: values.some((value) => value.dropTemplate) };
  }
  if (tokens.length === 1 && tokens[0]?.kind === "string") return { constant: tokens[0].text, lineage: lineage(tokens[0].text), dropTemplate: /\bdrop\s+(?:table|type|index)\b|\balter\s+table\b[^;]*\bdrop\s+column\b/i.test(tokens[0].text) };
  if (tokens.length === 1 && tokens[0]?.kind === "word") return variables.get(tokens[0].text) ?? { lineage: tokens[0].text === "currency_rates" };
  if (keyword(tokens[0], "format") && tokens[1]?.text === "(" && tokens.at(-1)?.text === ")") {
    const args = splitAt(tokens.slice(2, -1), ",").map((part) => evaluate(part, variables));
    let argument = 1, valid = args[0]?.constant !== undefined;
    const constant = valid ? args[0]!.constant!.replace(/%(?:(\d+)\$)?([sIL%])/g, (_, position: string | undefined, specifier: string) => {
      if (specifier === "%") return "%";
      const value = args[position ? Number(position) : argument++]?.constant; if (value === undefined) { valid = false; return ""; }
      if (specifier === "I") return `"${value.replaceAll('"', '""')}"`;
      if (specifier === "L") return `'${value.replaceAll("'", "''")}'`;
      return value;
    }) : undefined;
    return { constant: valid ? constant : undefined, lineage: args.some((value) => value.lineage), dropTemplate: args.some((value) => value.dropTemplate) };
  }
  return { lineage: tokens.some((token) => token.kind === "string" ? lineage(token.text) : token.kind === "word" && (token.text === "currency_rates" || variables.get(token.text)?.lineage === true)) };
};

const inspect = async (source: string, describe: DescribeSql, depth = 0): Promise<"invalid" | "destructive" | undefined> => {
  if (depth > 32) return "invalid";
  const statements = parseSql(source); if (!statements) return "invalid";
  const fileLineage = statements.some(({ tokens }) => visibleLineage(tokens));
  for (const statement of statements) {
    try { await describe(statement.sql); } catch { return "invalid"; }
    if (destructiveDdl(statement.tokens)) return "destructive";
    const words = statement.tokens;
    const nested = keyword(words[0], "do") ? words.find((token) => token.kind === "string") : keyword(words[0], "create") && words.some((token) => keyword(token, "function") || keyword(token, "procedure")) ? words.slice(words.findIndex((token) => keyword(token, "as")) + 1).find((token) => token.kind === "string") : undefined;
    if (nested) { const result = await inspectProgram(nested.text, describe, fileLineage, depth + 1); if (result) return result; }
  }
};

const inspectProgram = async (source: string, describe: DescribeSql, outerLineage: boolean, depth: number): Promise<"invalid" | "destructive" | undefined> => {
  if (depth > 32) return "invalid";
  const statements = parseSql(source); if (!statements) return "invalid";
  const variables = new Map<string, Value>(), fileLineage = outerLineage || statements.some(({ tokens }) => visibleLineage(tokens));
  for (const { tokens } of statements) {
    if (destructiveDdl(tokens)) return "destructive";
    const colon = tokens.findIndex((token) => token.text === ":="), defaultValue = tokens.findIndex((token) => keyword(token, "default")), equals = tokens.findIndex((token, offset) => token.text === "=" && (offset === 1 || offset === 2 && keyword(tokens[0], "begin")));
    const assignment = colon >= 0 ? colon : defaultValue >= 2 ? defaultValue : equals;
    if (assignment >= 0) {
      const declared = keyword(tokens[0], "declare"), name = declared ? tokens[1] : defaultValue === assignment ? tokens[0] : assignment > 1 && !keyword(tokens[0], "begin") ? tokens[0] : tokens[assignment - 1];
      if (name?.kind === "word") variables.set(name.text, evaluate(tokens.slice(assignment + 1), variables));
    }
    for (let index = 0; index < tokens.length; index++) {
      if (!keyword(tokens[index], "execute") || keyword(tokens[index + 1], "function") || keyword(tokens[index + 1], "procedure") || keyword(tokens[index + 1], "on")) continue;
      let end = index + 1; while (end < tokens.length && !keyword(tokens[end], "into") && !keyword(tokens[end], "using")) end++;
      const value = evaluate(tokens.slice(index + 1, end), variables);
      if (value.constant !== undefined) { const result = await inspect(value.constant, describe, depth + 1); if (result) return result; }
      else if (value.dropTemplate || fileLineage) return "destructive";
    }
  }
};

export const scanCurrencyRateMigrationSafety = async (files: readonly SqlSource[], describe: DescribeSql): Promise<readonly string[]> => {
  const findings = new Set<string>();
  for (const { path, source } of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const result = await inspect(source, describe);
    if (result) findings.add(`${path}: ${result === "invalid" ? "invalid PostgreSQL" : "destructive currency_rates SQL"}`);
  }
  return [...findings].sort();
};
