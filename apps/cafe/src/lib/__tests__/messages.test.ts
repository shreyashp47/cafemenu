/**
 * messages/en.json, messages/en.staff.json and the code that reads them agree
 * (issue #14): every key the code names exists, every key in the files is named
 * somewhere, and each call fills the {placeholders} its message has. The
 * compiler already checks the keys it can see (MessageKey); this reads the
 * source for the ones it cannot, a key kept in a table or picked by a ternary.
 *
 * The words are in two files so a customer's phone does not download the
 * staff board's: en.json for what the customer's routes can reach, en.staff.json
 * for the rest. The last tests hold the line between them.
 */

import { describe, expect, it } from "vitest";
import ts from "typescript";

import en from "../../../messages/en.json";
import enStaff from "../../../messages/en.staff.json";
import { importClosure, parse, sourceFiles, where } from "@/test/source";

type Message = string | Record<string, string>;

/** "order.viewOrder" -> its message, for every message in the file. */
function flatten(node: unknown, path = "", out = new Map<string, Message>()) {
  if (typeof node === "string") {
    out.set(path, node);
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    if (typeof record.other === "string") {
      out.set(path, record as Record<string, string>);
    } else {
      for (const [key, value] of Object.entries(record)) {
        flatten(value, path ? `${path}.${key}` : key, out);
      }
    }
  }
  return out;
}

const core = flatten(en);
const staff = flatten(enStaff);
const messages = new Map([...core, ...staff]);
const groups = new Set([...Object.keys(en), ...Object.keys(enStaff)]);
const KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

const forms = (message: Message) =>
  typeof message === "string" ? [message] : Object.values(message);
const placeholders = (message: Message) =>
  new Set(
    forms(message).flatMap((text) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
    ),
  );

interface Reference {
  key: string;
  at: string;
}

const references: Reference[] = [];
const problems: string[] = [];

for (const file of sourceFiles()) {
  const { sf } = parse(file);

  /** The literal keys an expression can be: through ?: and parentheses. */
  const keysOf = (node: ts.Expression): string[] => {
    if (ts.isParenthesizedExpression(node)) return keysOf(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return [node.text];
    }
    if (ts.isConditionalExpression(node)) {
      return [...keysOf(node.whenTrue), ...keysOf(node.whenFalse)];
    }
    return [];
  };

  const visit = (node: ts.Node) => {
    // Any string that is a key in one of the file's groups counts as naming it.
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      KEY.test(node.text) &&
      groups.has(node.text.split(".")[0])
    ) {
      references.push({ key: node.text, at: where(file, sf, node) });
    }

    // t("key", { a, b }) and rich("key", tags, { a, b }): placeholders match.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "t" || node.expression.text === "rich") &&
      node.arguments.length > 0
    ) {
      const isRich = node.expression.text === "rich";
      const keys = keysOf(node.arguments[0]).filter((k) => messages.has(k));
      const given = node.arguments[isRich ? 2 : 1];
      const names = new Set<string>();
      let known = true;
      if (given === undefined) {
        // nothing passed
      } else if (ts.isObjectLiteralExpression(given)) {
        for (const property of given.properties) {
          if (
            (ts.isPropertyAssignment(property) ||
              ts.isShorthandPropertyAssignment(property)) &&
            property.name !== undefined
          ) {
            names.add(property.name.getText(sf));
          } else {
            known = false;
          }
        }
      } else {
        known = false;
      }
      if (known) {
        for (const key of keys) {
          const message = messages.get(key)!;
          const wanted = placeholders(message);
          if (typeof message !== "string") wanted.add("count");
          const at = where(file, sf, node);
          for (const name of wanted) {
            if (!names.has(name)) {
              problems.push(`${at} ${key}: {${name}} is not filled in`);
            }
          }
          if (keys.length === 1) {
            for (const name of names) {
              if (!wanted.has(name)) {
                problems.push(`${at} ${key}: ${name} is not in the message`);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** The routes a customer's phone loads. */
const CUSTOMER_ENTRIES = [
  "app/layout.tsx",
  "app/page.tsx",
  "app/order/page.tsx",
  "app/order/confirmation/page.tsx",
  "app/offline/page.tsx",
];

describe("messages/en.json", () => {
  it("has a message for every key the code names", () => {
    const missing = references
      .filter((r) => !messages.has(r.key))
      .map((r) => `${r.at} ${r.key}`);
    expect(missing).toEqual([]);
  });

  it("is used: every message is named somewhere", () => {
    const used = new Set(references.map((r) => r.key));
    const unused = [...messages.keys()].filter((key) => !used.has(key));
    expect(unused).toEqual([]);
  });

  it("is called with the placeholders its messages have", () => {
    expect(problems).toEqual([]);
  });

  it("has no empty messages, and plural forms that are known", () => {
    const empty: string[] = [];
    for (const [key, message] of messages) {
      if (typeof message !== "string") {
        for (const form of Object.keys(message)) {
          if (!["zero", "one", "two", "few", "many", "other"].includes(form)) {
            empty.push(`${key}.${form} is not a plural form`);
          }
        }
      }
      for (const text of forms(message)) {
        if (!text.trim()) empty.push(key);
      }
    }
    expect(empty).toEqual([]);
  });

  it("closes the tags it opens", () => {
    const open = [...messages].flatMap(([key, message]) =>
      forms(message)
        .filter((text) => {
          const opens = text.match(/<(\w+)>/g) ?? [];
          return opens.some((tag) => {
            const name = tag.slice(1, -1);
            return !text.includes(`</${name}>`);
          });
        })
        .map(() => key),
    );
    expect(open).toEqual([]);
  });

  it("fills no placeholder in a plural form that `other` does not have", () => {
    // A form may spell the number out ("One for the road?") and leave {count}
    // out; none may need something the general form cannot give it.
    const odd = [...messages]
      .filter(([, message]) => typeof message !== "string")
      .filter(([, message]) => {
        const other = placeholders((message as Record<string, string>).other);
        return forms(message).some((text) =>
          [...placeholders(text)].some((name) => !other.has(name)),
        );
      })
      .map(([key]) => key);
    expect(odd).toEqual([]);
  });

  it("keeps each message in one of the two files, and each group in one", () => {
    const both = [...core.keys()].filter((key) => staff.has(key));
    expect(both).toEqual([]);
    const shared = Object.keys(en).filter((group) => group in enStaff);
    expect(shared).toEqual([]);
  });

  describe("what a customer's phone downloads", () => {
    const reachable = new Set<string>();
    for (const file of importClosure(CUSTOMER_ENTRIES)) {
      const { sf } = parse(file);
      const visit = (node: ts.Node) => {
        if (
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node)) &&
          KEY.test(node.text) &&
          groups.has(node.text.split(".")[0])
        ) {
          reachable.add(node.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    it("never asks for a staff message", () => {
      const leaked = [...reachable].filter((key) => staff.has(key));
      expect(
        leaked,
        "Move these groups from en.staff.json to en.json, or stop the customer's screens reaching the code that shows them",
      ).toEqual([]);
    });

    it("is only words the customer's screens can reach", () => {
      const idle = Object.keys(en).filter(
        (group) => ![...reachable].some((key) => key.startsWith(`${group}.`)),
      );
      expect(
        idle,
        "These groups are in en.json but no customer route reaches them: move them to en.staff.json",
      ).toEqual([]);
    });
  });
});
