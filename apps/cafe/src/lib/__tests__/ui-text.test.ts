/**
 * The words a screen shows come out of messages/en.json through t() (issue #14).
 * This fails on any that were typed into the JSX instead, so a new screen
 * cannot quietly bring back English a translation would never reach:
 *
 *   <h1>Hello</h1>                 JSX text
 *   <Button label="Save" />        a text-bearing prop, or any prose prop
 *   {open ? "Close" : "Open"}      a literal in an expression child or prop
 *   aria-label={`Remove ${name}`}  a template with words in it
 *
 * It reads src/app and src/components. Strings that are not words (class
 * names, ids, icon names, symbols) have no letters or look like code, and the
 * few real exceptions are listed in ALLOWED, each with its reason.
 */

import { describe, expect, it } from "vitest";
import ts from "typescript";

import { parse, parseText, sourceFiles, where } from "@/test/source";

/** Props that carry words for people, whatever they hold. */
const TEXT_PROPS = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "alt",
  "title",
  "placeholder",
  "label",
  "hint",
  "body",
  "srContext",
]);

/** Props whose strings are code, even when they have spaces and letters. */
const CODE_PROPS = new Set(["className", "style", "transform"]);

const ALLOWED: Array<{ file: string; text: string; why: string }> = [];

const hasLetters = (s: string) => /\p{L}/u.test(s);
/** Two words in a row: prose, not a token. */
const looksLikeProse = (s: string) => /\p{L}{2,}\s+\p{L}{2,}/u.test(s);

/** JSX's own whitespace rules: lines trimmed and joined by one space. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let last = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) last = i;
  });
  let out = "";
  lines.forEach((line, i) => {
    let text = line.replace(/\t/g, " ");
    if (i !== 0) text = text.replace(/^ +/, "");
    if (i !== lines.length - 1) text = text.replace(/ +$/, "");
    if (text) out += i === last ? text : `${text} `;
  });
  return out.trim();
}

/** The literals an expression can evaluate to, looking through ?:, && and so on. */
function literalsOf(
  node: ts.Expression,
): Array<{ node: ts.Node; text: string }> {
  if (ts.isParenthesizedExpression(node)) return literalsOf(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [{ node, text: node.text }];
  }
  if (ts.isTemplateExpression(node)) {
    const text = [node.head, ...node.templateSpans.map((s) => s.literal)]
      .map((part) => part.text)
      .join(" ");
    return [{ node, text }];
  }
  if (ts.isConditionalExpression(node)) {
    return [...literalsOf(node.whenTrue), ...literalsOf(node.whenFalse)];
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...literalsOf(node.left), ...literalsOf(node.right)];
    }
  }
  return [];
}

function findingsIn(file: string, parsed: ReturnType<typeof parse>): string[] {
  const { sf, text } = parsed;
  const found: string[] = [];
  const report = (node: ts.Node, shown: string) =>
    found.push(`${where(file, sf, node)}  ${JSON.stringify(shown)}`);

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const words = jsxText(text.slice(node.pos, node.end));
      if (hasLetters(words)) report(node, words);
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      // {"Hello"} or {open ? "Close" : "Open"} as a child
      if (node.expression) {
        for (const { node: at, text: words } of literalsOf(node.expression)) {
          if (hasLetters(words)) report(at, words);
        }
      }
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      const isText =
        TEXT_PROPS.has(name) ||
        (!CODE_PROPS.has(name) && !name.startsWith("data-"));
      const literals = ts.isStringLiteral(node.initializer)
        ? [{ node: node.initializer, text: node.initializer.text }]
        : ts.isJsxExpression(node.initializer) && node.initializer.expression
          ? literalsOf(node.initializer.expression)
          : [];
      for (const { node: at, text: words } of literals) {
        if (!hasLetters(words) || CODE_PROPS.has(name)) continue;
        if (TEXT_PROPS.has(name) || (isText && looksLikeProse(words))) {
          report(at, `${name}=${words}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return found.filter((line) => {
    return !ALLOWED.some(
      (a) => line.startsWith(a.file) && line.includes(JSON.stringify(a.text)),
    );
  });
}

describe("words in JSX", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")].filter(
    (f) => f.endsWith(".tsx"),
  );

  it("scans the screens and the components", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("are all messages, not literals", () => {
    const all = files.flatMap((file) => findingsIn(file, parse(file)));
    expect(all, `Move these into messages/en.json:\n${all.join("\n")}`).toEqual(
      [],
    );
  });

  describe("the check itself", () => {
    const check = (source: string) =>
      findingsIn("x.tsx", parseText("x.tsx", source)).length;

    it("catches words in JSX text, props and expressions", () => {
      expect(check("const a = <p>Hello there</p>;")).toBe(1);
      expect(check('const a = <input aria-label="Name" />;')).toBe(1);
      expect(check('const a = <Field hint="Up to 140 characters." />;')).toBe(
        1,
      );
      expect(check('const a = <p>{open ? "Close" : "Open"}</p>;')).toBe(2);
      expect(check("const a = <p>{open && `Added ${n} items`}</p>;")).toBe(1);
      expect(check("const a = <Sheet title={`Table ${n}`} />;")).toBe(1);
      expect(check("const a = <p>\n  Table {n}\n</p>;")).toBe(1);
    });

    it("lets messages, symbols and code through", () => {
      expect(check('const a = <p>{t("order.viewOrder")}</p>;')).toBe(0);
      expect(check("const a = <p>{n}×</p>;")).toBe(0);
      expect(check("const a = <p>  </p>;")).toBe(0);
      expect(check('const a = <b className="text-lg font-semibold" />;')).toBe(
        0,
      );
      expect(check('const a = <i id="menu-heading" role="status" />;')).toBe(0);
      expect(check('const a = <Icon name="qr" size={18} />;')).toBe(0);
      expect(check('const a = <b className={x ? "a b" : "c d"} />;')).toBe(0);
      expect(check('const a = <b onClick={() => go("All")} />;')).toBe(0);
    });
  });
});
