import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { formatNumber, getLocale, setLocale, t } from "@/lib/i18n";
import { dayLabelOf } from "@/lib/reports";
import { rich } from "@/lib/i18n-rich";

afterEach(() => setLocale("en-IN"));

describe("t", () => {
  it("returns the English message", () => {
    expect(t("order.viewOrder")).toBe("View order");
  });

  it("fills {name} placeholders, and leaves an unfilled one as written", () => {
    expect(t("order.tableTitle", { table: 4 })).toBe("Table 4");
    expect(t("order.tableTitle")).toBe("Table {table}");
    expect(t("order.removeOne", { name: "Chai", extra: "ignored" })).toBe(
      "Remove one Chai",
    );
  });

  it("picks the plural form from the count", () => {
    expect(t("order.itemsGoing", { count: 1 })).toBe("One for the road?");
    expect(t("order.itemsGoing", { count: 3 })).toBe(
      "3 items going on order #soon.",
    );
  });

  it("answers with the key itself for a message nobody wrote", () => {
    expect(t("nowhere.at.all" as never)).toBe("nowhere.at.all");
  });

  it("follows the cafe's locale, and falls back to English for the rest", () => {
    setLocale("en-US");
    expect(getLocale()).toBe("en-US");
    expect(t("order.viewOrder")).toBe("View order");
    setLocale("xx-YY");
    expect(t("order.viewOrder")).toBe("View order");
    // The words are English, so their plurals follow English even in a cafe
    // whose own language has none (Japanese).
    setLocale("ja-JP");
    expect(t("count.items", { count: 1 })).toBe("1 item");
    expect(t("count.items", { count: 5 })).toBe("5 items");
    expect(t("order.itemsGoing", { count: 2 })).toBe(
      "2 items going on order #soon.",
    );
  });
});

describe("dates and numbers", () => {
  it("follow the cafe's locale, not a fixed one", () => {
    setLocale("en-IN");
    expect(dayLabelOf("2026-03-05")).toBe("5 Mar");
    expect(formatNumber(1234567)).toBe("12,34,567");
    setLocale("en-US");
    expect(dayLabelOf("2026-03-05")).toBe("Mar 5");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});

describe("rich", () => {
  it("wraps the tagged words and keeps the rest as text", () => {
    const { container } = render(
      <p>
        {rich(
          "order.demoNotice",
          {
            strong: (c) => <strong>{c}</strong>,
            code: (c) => <code>{c}</code>,
          },
          {},
        )}
      </p>,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Demo mode.");
    expect(container.querySelector("code")?.textContent).toBe(".env.local");
    expect(container.textContent).toBe(
      "Demo mode. Orders are saved in this browser only. Add Firebase keys to .env.local to go live.",
    );
  });

  it("shows the words plainly for a tag nobody handled", () => {
    const { container } = render(<p>{rich("order.demoNotice", {})}</p>);
    expect(container.textContent).toContain("Demo mode.");
    expect(container.textContent).not.toContain("<");
  });
});
