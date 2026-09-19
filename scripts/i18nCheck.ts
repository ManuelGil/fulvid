import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";

export type MessageCatalog = Record<string, unknown>;
export type LocaleCatalogs = Readonly<Record<string, MessageCatalog>>;

export type CatalogDifference = {
  locale: string;
  key: string;
};

export type TypeMismatch = {
  locale: string;
  key: string;
  expected: CatalogNodeKind;
  actual: CatalogNodeKind;
};

export type PlaceholderMismatch = {
  locale: string;
  key: string;
  expected: readonly string[];
  actual: readonly string[];
};

export type TranslationUsage = {
  file: string;
  line: number;
  key: string;
};

export type DynamicTranslationUsage = {
  file: string;
  line: number;
  expression: string;
};

export type HardcodedUiString = {
  file: string;
  line: number;
  attribute: string;
  value: string;
};

export type I18nAuditReport = {
  locales: readonly string[];
  referenceLocale: string;
  missingKeys: readonly CatalogDifference[];
  extraKeys: readonly CatalogDifference[];
  typeMismatches: readonly TypeMismatch[];
  placeholderMismatches: readonly PlaceholderMismatch[];
  unescapedPipes: readonly CatalogDifference[];
  missingUsages: readonly TranslationUsage[];
  dynamicUsages: readonly DynamicTranslationUsage[];
  hardcodedUiStrings: readonly HardcodedUiString[];
};

type SourceFile = {
  path: string;
  content: string;
};

type SourceRegion = {
  content: string;
  offset: number;
};

type CatalogNodeKind = "array" | "boolean" | "null" | "number" | "object" | "string" | "undefined";

type CatalogNode = {
  kind: CatalogNodeKind;
  value?: string;
};

type CallUsage = {
  expression: string;
  keys: readonly string[] | null;
  offset: number;
};

const LOCALE_FILE_PATTERN = /^[a-z]{2,3}(?:[-_][a-z0-9]+)*\.ts$/i;
const STATIC_UI_ATTRIBUTE_PATTERN =
  /\b(aria-label|aria-description|placeholder|title|alt|label)\s*=\s*(["'])([\s\S]*?)\2/g;

function isCatalog(value: unknown): value is MessageCatalog {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogNodeKind(value: unknown): CatalogNodeKind {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value as CatalogNodeKind;
}

function collectCatalogNodes(
  value: unknown,
  prefix = "",
  nodes = new Map<string, CatalogNode>(),
): Map<string, CatalogNode> {
  if (prefix) {
    const kind = catalogNodeKind(value);
    nodes.set(prefix, {
      kind,
      ...(typeof value === "string" ? { value } : {}),
    });
  }

  if (isCatalog(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectCatalogNodes(child, prefix ? `${prefix}.${key}` : key, nodes);
    }
  }

  return nodes;
}

function leafKeys(nodes: ReadonlyMap<string, CatalogNode>): Set<string> {
  return new Set(
    [...nodes.entries()].filter(([, node]) => node.kind !== "object").map(([key]) => key),
  );
}

function placeholders(value: string): readonly string[] {
  const counts = new Map<string, number>();
  for (const match of value.matchAll(/\{\s*([^},]+?)(?:\s*,[^}]*)?\s*\}/g)) {
    const name = match[1]?.trim();
    if (name) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, count]) => Array.from({ length: count }, () => name));
}

function sortedDifferences<T extends CatalogDifference>(differences: T[]): T[] {
  return differences.sort(
    (left, right) => left.locale.localeCompare(right.locale) || left.key.localeCompare(right.key),
  );
}

function sortedByLocation<T extends { file: string; line: number }>(entries: T[]): T[] {
  return entries.sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  );
}

/** vue-i18n treats `|` as a plural separator unless the catalog value uses `\|`. */
function unescapedPipeKeys(
  locale: string,
  nodes: ReadonlyMap<string, CatalogNode>,
): CatalogDifference[] {
  const differences: CatalogDifference[] = [];
  for (const [key, node] of nodes) {
    if (node.kind !== "string" || !node.value) {
      continue;
    }
    if (/(?<!\\)\|/.test(node.value)) {
      differences.push({ locale, key });
    }
  }
  return differences;
}

/**
 * Compare every discovered catalog with the first locale in sorted order.
 *
 * The reference is deliberately positional rather than language-specific:
 * adding `fr.ts` or `pt-BR.ts` does not require changing this auditor.
 */
export function auditCatalogs(
  catalogs: LocaleCatalogs,
): Pick<
  I18nAuditReport,
  | "locales"
  | "referenceLocale"
  | "missingKeys"
  | "extraKeys"
  | "typeMismatches"
  | "placeholderMismatches"
  | "unescapedPipes"
> {
  const locales = Object.keys(catalogs).sort((left, right) => left.localeCompare(right));
  const referenceLocale = locales[0] ?? "";
  const referenceNodes = collectCatalogNodes(catalogs[referenceLocale] ?? {});
  const referenceLeaves = leafKeys(referenceNodes);
  const missingKeys: CatalogDifference[] = [];
  const extraKeys: CatalogDifference[] = [];
  const typeMismatches: TypeMismatch[] = [];
  const placeholderMismatches: PlaceholderMismatch[] = [];
  const unescapedPipes = unescapedPipeKeys(referenceLocale, referenceNodes);

  for (const locale of locales.slice(1)) {
    const localeNodes = collectCatalogNodes(catalogs[locale]);
    const localeLeaves = leafKeys(localeNodes);

    for (const key of referenceLeaves) {
      if (!localeLeaves.has(key)) {
        missingKeys.push({ locale, key });
      }
    }

    for (const key of localeLeaves) {
      if (!referenceLeaves.has(key)) {
        extraKeys.push({ locale, key });
      }
    }

    for (const [key, expected] of referenceNodes) {
      const actual = localeNodes.get(key);
      if (!actual || actual.kind === expected.kind) {
        continue;
      }
      typeMismatches.push({
        locale,
        key,
        expected: expected.kind,
        actual: actual.kind,
      });
    }

    for (const key of referenceLeaves) {
      const expected = referenceNodes.get(key);
      const actual = localeNodes.get(key);
      if (expected?.kind !== "string" || actual?.kind !== "string") {
        continue;
      }
      const expectedPlaceholders = placeholders(expected.value ?? "");
      const actualPlaceholders = placeholders(actual.value ?? "");
      if (expectedPlaceholders.join("\u0000") !== actualPlaceholders.join("\u0000")) {
        placeholderMismatches.push({
          locale,
          key,
          expected: expectedPlaceholders,
          actual: actualPlaceholders,
        });
      }
    }

    unescapedPipes.push(...unescapedPipeKeys(locale, localeNodes));
  }

  return {
    locales,
    referenceLocale,
    missingKeys: sortedDifferences(missingKeys),
    extraKeys: sortedDifferences(extraKeys),
    typeMismatches: sortedDifferences(typeMismatches),
    placeholderMismatches: sortedDifferences(placeholderMismatches),
    unescapedPipes: sortedDifferences(unescapedPipes),
  };
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticKeysFromNode(node: ts.Expression): readonly string[] | null {
  const expression = unwrapExpression(node);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression.text];
  }
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = staticKeysFromNode(expression.whenTrue);
    const whenFalse = staticKeysFromNode(expression.whenFalse);
    if (!whenTrue || !whenFalse) {
      return null;
    }
    return [...new Set([...whenTrue, ...whenFalse])];
  }
  return null;
}

function isTranslationCallee(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "t" || expression.text === "$t";
  }
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "t") {
    return false;
  }
  const global = expression.expression;
  return (
    ts.isPropertyAccessExpression(global) &&
    global.name.text === "global" &&
    ts.isIdentifier(global.expression) &&
    global.expression.text === "i18n"
  );
}

function scanTranslationCalls(source: string, offset: number): CallUsage[] {
  const calls: CallUsage[] = [];
  const file = ts.createSourceFile(
    "__fulvid_i18n_source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isTranslationCallee(node.expression)) {
      const argument = node.arguments[0];
      calls.push({
        expression: argument?.getText(file) ?? "",
        keys: argument ? staticKeysFromNode(argument) : null,
        offset: offset + node.getStart(file),
      });
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      (node.name.text === "label" || node.name.text === "hint")
    ) {
      const keys = staticKeysFromNode(node.initializer);
      for (const key of keys ?? []) {
        if (key.includes(".")) {
          calls.push({
            expression: key,
            keys: [key],
            offset: offset + node.initializer.getStart(file),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return calls;
}

function taggedRegions(source: string, tag: string): SourceRegion[] {
  const regions: SourceRegion[] = [];
  const openingPattern = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi");
  for (const opening of source.matchAll(openingPattern)) {
    const start = (opening.index ?? 0) + opening[0].length;
    const end = source.indexOf(`</${tag}>`, start);
    if (end < 0) {
      continue;
    }
    regions.push({ content: source.slice(start, end), offset: start });
  }
  return regions;
}

function templateExpressionRegions(source: string): SourceRegion[] {
  const regions: SourceRegion[] = [];
  const interpolationPattern = /\{\{([\s\S]*?)\}\}/g;
  for (const match of source.matchAll(interpolationPattern)) {
    const content = match[1] ?? "";
    regions.push({ content, offset: (match.index ?? 0) + match[0].indexOf(content) });
  }

  const boundAttributePattern =
    /(?:^|\s)(?::[\w.-]+|v-bind:[\w.-]+|@[\w.-]+|v-on:[\w.-]+|v-(?:if|else-if|show|text|html|for))\s*=\s*(["'])/g;
  for (const match of source.matchAll(boundAttributePattern)) {
    const quote = match[1];
    const quoteIndex = (match.index ?? 0) + match[0].lastIndexOf(quote);
    const start = quoteIndex + 1;
    const end = source.indexOf(quote, start);
    if (end >= 0) {
      regions.push({ content: source.slice(start, end), offset: start });
    }
  }
  return regions;
}

function sourceRegions(file: SourceFile): SourceRegion[] {
  if (!file.path.endsWith(".vue")) {
    return [{ content: file.content, offset: 0 }];
  }
  return [...taggedRegions(file.content, "script"), ...templateExpressionRegions(file.content)];
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function hardcodedUiStrings(file: SourceFile): HardcodedUiString[] {
  if (!file.path.endsWith(".vue")) {
    return [];
  }
  const matches: HardcodedUiString[] = [];
  for (const template of taggedRegions(file.content, "template")) {
    for (const match of template.content.matchAll(STATIC_UI_ATTRIBUTE_PATTERN)) {
      const attribute = match[1] ?? "";
      const value = match[3]?.trim() ?? "";
      const start = match.index ?? 0;
      const previous = template.content[start - 1];
      if (!value || previous === ":" || previous === "-" || previous === "@") {
        continue;
      }
      matches.push({
        file: file.path,
        line: lineAt(file.content, template.offset + start),
        attribute,
        value,
      });
    }
  }
  return matches;
}

function auditUsages(
  catalogs: LocaleCatalogs,
  sources: readonly SourceFile[],
): Pick<I18nAuditReport, "missingUsages" | "dynamicUsages" | "hardcodedUiStrings"> {
  const availableKeys = new Set<string>();
  for (const catalog of Object.values(catalogs)) {
    for (const key of leafKeys(collectCatalogNodes(catalog))) {
      availableKeys.add(key);
    }
  }

  const missingUsages: TranslationUsage[] = [];
  const dynamicUsages: DynamicTranslationUsage[] = [];
  const hardcodedStrings: HardcodedUiString[] = [];

  for (const file of sources) {
    for (const region of sourceRegions(file)) {
      for (const call of scanTranslationCalls(region.content, region.offset)) {
        if (!call.keys) {
          dynamicUsages.push({
            file: file.path,
            line: lineAt(file.content, call.offset),
            expression: call.expression || "<empty>",
          });
          continue;
        }
        for (const key of call.keys) {
          if (!availableKeys.has(key)) {
            missingUsages.push({
              file: file.path,
              line: lineAt(file.content, call.offset),
              key,
            });
          }
        }
      }
    }
    hardcodedStrings.push(...hardcodedUiStrings(file));
  }

  return {
    missingUsages: sortedByLocation(missingUsages),
    dynamicUsages: sortedByLocation(dynamicUsages),
    hardcodedUiStrings: sortedByLocation(hardcodedStrings),
  };
}

export function auditI18n(
  catalogs: LocaleCatalogs,
  sources: readonly SourceFile[] = [],
): I18nAuditReport {
  return {
    ...auditCatalogs(catalogs),
    ...auditUsages(catalogs, sources),
  };
}

export function hasBlockingIssues(report: I18nAuditReport): boolean {
  return (
    report.missingKeys.length > 0 ||
    report.extraKeys.length > 0 ||
    report.typeMismatches.length > 0 ||
    report.placeholderMismatches.length > 0 ||
    report.unescapedPipes.length > 0 ||
    report.missingUsages.length > 0 ||
    report.hardcodedUiStrings.length > 0
  );
}

export async function discoverLocaleCatalogs(directory: string): Promise<LocaleCatalogs> {
  const entries = await readdir(directory, { withFileTypes: true });
  const localeFiles = entries
    .filter(
      (entry) =>
        entry.isFile() && entry.name !== "index.ts" && LOCALE_FILE_PATTERN.test(entry.name),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  if (localeFiles.length === 0) {
    throw new Error(`No locale modules found in ${directory}`);
  }

  const loaded = await Promise.all(
    localeFiles.map(async (entry) => {
      const moduleUrl = pathToFileURL(join(directory, entry.name)).href;
      const module = (await import(moduleUrl)) as { default?: unknown };
      if (!isCatalog(module.default)) {
        throw new Error(`Locale module ${entry.name} must export a catalog as default`);
      }
      return [basename(entry.name, extname(entry.name)), module.default] as const;
    }),
  );

  return Object.fromEntries(loaded);
}

async function discoverSourceFiles(directory: string, root: string): Promise<SourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: SourceFile[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverSourceFiles(path, root)));
      continue;
    }
    if (
      !entry.isFile() ||
      !/\.(ts|vue)$/.test(entry.name) ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".d.ts")
    ) {
      continue;
    }
    files.push({
      path: relative(root, path),
      content: await readFile(path, "utf8"),
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function printSection<T>(title: string, entries: readonly T[], format: (entry: T) => string): void {
  if (entries.length === 0) {
    return;
  }
  console.log(`${title} (${entries.length})`);
  for (const entry of entries) {
    console.log(`  - ${format(entry)}`);
  }
  console.log();
}

function printReport(report: I18nAuditReport): void {
  console.log("\nFulvid i18n check\n");
  console.log(`Locales: ${report.locales.join(", ")}`);
  console.log(`Reference structure: ${report.referenceLocale || "none"}\n`);

  printSection(
    "Missing catalog keys",
    report.missingKeys,
    (entry) => `${entry.locale}: ${entry.key}`,
  );
  printSection("Extra catalog keys", report.extraKeys, (entry) => `${entry.locale}: ${entry.key}`);
  printSection(
    "Catalog type mismatches",
    report.typeMismatches,
    (entry) => `${entry.locale}: ${entry.key} (${entry.expected} -> ${entry.actual})`,
  );
  printSection(
    "Placeholder mismatches",
    report.placeholderMismatches,
    (entry) =>
      `${entry.locale}: ${entry.key} (${entry.expected.join(", ") || "none"} -> ${
        entry.actual.join(", ") || "none"
      })`,
  );
  printSection(
    "Unescaped | in messages",
    report.unescapedPipes,
    (entry) => `${entry.locale}: ${entry.key} (use \\| so vue-i18n keeps a literal |)`,
  );
  printSection(
    "Missing keys used by source",
    report.missingUsages,
    (entry) => `${entry.file}:${entry.line}: ${entry.key}`,
  );
  printSection(
    "Hardcoded UI attributes",
    report.hardcodedUiStrings,
    (entry) => `${entry.file}:${entry.line}: ${entry.attribute}="${entry.value}"`,
  );
  if (report.dynamicUsages.length > 0) {
    console.log(`Dynamic translation keys skipped (${report.dynamicUsages.length})`);
    for (const entry of report.dynamicUsages) {
      console.log(`  - ${entry.file}:${entry.line}: ${entry.expression}`);
    }
    console.log("  These require human review and are not treated as missing keys.\n");
  }

  if (hasBlockingIssues(report)) {
    console.error("i18n check failed.");
  } else {
    console.log("i18n check passed.");
  }
}

export async function runI18nCheck(root = resolve(import.meta.dir, "..")): Promise<number> {
  const catalogs = await discoverLocaleCatalogs(join(root, "src/mainview/i18n"));
  const sources = await discoverSourceFiles(join(root, "src/mainview"), root);
  const report = auditI18n(catalogs, sources);
  printReport(report);
  return hasBlockingIssues(report) ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runI18nCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
