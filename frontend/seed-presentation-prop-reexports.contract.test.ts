import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const frontendRoot = import.meta.dir;
const seedTypesPath = resolve(frontendRoot, "src/domains/seeds/domain/types.ts");
const planningTypesPath = resolve(frontendRoot, "src/domains/planning/domain/types.ts");
const planningModule = "@/domains/planning/domain/types";
const retired = ["SeedDetailPanelProps", "SeedChipProps", "SeedListProps", "SeedQuickAddProps", "SeedSelectionBarProps"];
const remaining = [
  "Seed", "SeedWithRelations", "SeedStatus", "SeedSource", "SeedPriority", "SeedFilters", "SeedComment", "SeedEvent",
  "SeedTag", "SeedFeedbackLink", "SeedWorkItemLink", "CreateSeedRequest", "UpdateSeedRequest", "PromoteSeedRequest",
  "PaginatedSeedsResponse",
];
const owners: Record<string, string> = {
  SeedDetailPanelProps: "src/domains/planning/presentation/components/seed-detail-panel.tsx",
  SeedChipProps: "src/domains/planning/presentation/components/seed-chip.tsx",
  SeedListProps: "src/domains/planning/presentation/components/seed-list.tsx",
  SeedQuickAddProps: "src/domains/planning/presentation/components/seed-quick-add.tsx",
  SeedSelectionBarProps: "src/domains/planning/presentation/components/seed-selection-bar.tsx",
};

function parse(source: string, fileName: string): ts.SourceFile {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length) throw new Error(`${fileName}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, "\n")}`);
  return file;
}

function text(node: ts.Node | undefined): string | undefined {
  return node && ts.isIdentifier(node) ? node.text : undefined;
}

function planningExports(source: string): string[] {
  const file = parse(source, seedTypesPath);
  const declarations = file.statements.filter(
    (node): node is ts.ExportDeclaration => ts.isExportDeclaration(node) && node.moduleSpecifier?.getText(file) === `"${planningModule}"`,
  );
  if (declarations.length !== 1 || !declarations[0].exportClause || !ts.isNamedExports(declarations[0].exportClause)) return [];
  return declarations[0].exportClause.elements.map((element) => text(element.name) ?? "");
}

function exportNames(element: ts.ExportSpecifier): string[] {
  return [text(element.propertyName), text(element.name)].filter((name): name is string => !!name);
}

function hasForbiddenEquivalent(source: string): boolean {
  let found = false;
  const file = parse(source, "fixture.ts");
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) found = true;
      if (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some((element) => exportNames(element).some((name) => retired.includes(name)))) found = true;
    }
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) || ts.isVariableDeclaration(node)) &&
      retired.includes(text(node.name) ?? "")
    ) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function hasOwnerImport(source: string, typeName: string, fileName: string): boolean {
  const file = parse(source, fileName);
  return file.statements.some(
    (node) =>
      ts.isImportDeclaration(node) &&
      node.importClause?.isTypeOnly === true &&
      node.moduleSpecifier.getText(file) === '"../../domain/types"' &&
      !!node.importClause.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some((element) => !element.propertyName && element.name.text === typeName),
  );
}

describe("Seed presentation prop reexports", () => {
  it("removes exactly the five dead names and preserves the fifteen live reexports", () => {
    const exports = planningExports(readFileSync(seedTypesPath, "utf8"));
    expect(retired.filter((name) => exports.includes(name))).toEqual([]);
    expect(exports).toEqual(remaining);
    expect(hasForbiddenEquivalent(readFileSync(seedTypesPath, "utf8"))).toBe(false);
  });

  it("preserves canonical planning definitions and their five direct owner imports", () => {
    const planning = parse(readFileSync(planningTypesPath, "utf8"), planningTypesPath);
    const definitions = planning.statements
      .filter((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
      .map((node) => text(node.name));
    expect(retired.every((name) => definitions.includes(name))).toBe(true);
    expect(Object.entries(owners).every(([name, path]) => hasOwnerImport(readFileSync(resolve(frontendRoot, path), "utf8"), name, path))).toBe(true);
  });

  it("fails closed for direct, alias, wildcard, namespace, and local equivalents without matching decoys", () => {
    const unsafe = [
      `export type { SeedChipProps } from "${planningModule}";`,
      `export type { SeedChipProps as LegacySeedChipProps } from "${planningModule}";`,
      `export type * from "${planningModule}";`,
      `export type * as Seeds from "${planningModule}";`,
      "export interface SeedChipProps {}",
      "export const SeedChipProps = {};",
    ];
    const safe = [
      `export type { Seed as LegacySeed } from "${planningModule}";`,
      `// export type { SeedChipProps } from "${planningModule}";`,
      'const text = "SeedChipProps";',
      `export type { SeedChipPropsExtra } from "${planningModule}";`,
    ];
    expect(unsafe.every(hasForbiddenEquivalent)).toBe(true);
    expect(safe.every((source) => !hasForbiddenEquivalent(source))).toBe(true);
    expect(hasForbiddenEquivalent(`export type { Shadow as SeedChipProps } from "${planningModule}";`)).toBe(true);
    expect(() => hasForbiddenEquivalent("export type {")).toThrow(/fixture\.ts:/u);
  });
});
