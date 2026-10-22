/**
 * Reading the app's own source for the tests that police it: the words in
 * JSX (ui-text.test.ts) and the message keys (messages.test.ts).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/** apps/cafe/src */
export const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
/** apps/cafe */
export const APP = join(SRC, "..");

/** Every .ts/.tsx under `dir` (relative to src), tests and fixtures left out. */
export function sourceFiles(dir = "."): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "test") walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(join(SRC, dir));
  return out.sort();
}

export function parseText(
  name: string,
  text: string,
): { sf: ts.SourceFile; text: string } {
  const sf = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return { sf, text };
}

export function parse(file: string): { sf: ts.SourceFile; text: string } {
  return parseText(file, readFileSync(file, "utf8"));
}

/** "app/staff/page.tsx:12" */
export function where(file: string, sf: ts.SourceFile, node: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${relative(SRC, file)}:${line + 1}`;
}

const RESOLVE = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(dirname(from), specifier);
  else return null; // a package
  for (const ext of ["", ...RESOLVE]) {
    const candidate = base + ext;
    try {
      if (/\.tsx?$/.test(candidate) && readFileSync(candidate))
        return candidate;
    } catch {
      // try the next spelling
    }
  }
  return null;
}

/**
 * Every source file the given entries can pull in, by static and dynamic
 * imports: what a route's JavaScript is made of. Entries are paths relative
 * to src.
 */
export function importClosure(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map((entry) => join(SRC, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const { sf } = parse(file);
    const visit = (node: ts.Node) => {
      let specifier: string | null = null;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifier = node.moduleSpecifier.text;
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specifier = node.arguments[0].text;
      }
      if (specifier) {
        const target = resolveImport(file, specifier);
        if (target) queue.push(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...seen].sort();
}
