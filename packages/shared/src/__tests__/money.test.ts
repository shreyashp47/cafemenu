import { describe, expect, it } from "vitest";

import {
  currencyDigits,
  currencySymbol,
  defaultMaxOrderTotal,
  formatMoney,
  moneyDigits,
  moneyToDecimal,
  parseMoneyInput,
  type MoneySettings,
} from "../money.ts";

const INR: MoneySettings = {
  currency: "INR",
  locale: "en-IN",
  moneyUnit: "minor",
};
const USD: MoneySettings = {
  currency: "USD",
  locale: "en-US",
  moneyUnit: "minor",
};
const JPY: MoneySettings = {
  currency: "JPY",
  locale: "ja-JP",
  moneyUnit: "minor",
};
const EUR_DE: MoneySettings = {
  currency: "EUR",
  locale: "de-DE",
  moneyUnit: "minor",
};
const KWD: MoneySettings = {
  currency: "KWD",
  locale: "en",
  moneyUnit: "minor",
};
/** TOE until #21: whole rupees. */
const TOE: MoneySettings = { ...INR, moneyUnit: "major" };

// Intl puts a no-break space between number and symbol in some locales.
const plain = (s: string) => s.replace(/\s/g, " ");

describe("digits", () => {
  it("come from Intl for the currency", () => {
    expect(currencyDigits("INR")).toBe(2);
    expect(currencyDigits("USD", "en-US")).toBe(2);
    expect(currencyDigits("EUR", "de-DE")).toBe(2);
    expect(currencyDigits("JPY", "ja-JP")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
  });

  it("are 0 in the stored integers while a cafe keeps whole units", () => {
    expect(moneyDigits(INR)).toBe(2);
    expect(moneyDigits(TOE)).toBe(0);
    expect(moneyDigits(JPY)).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats paise as rupees, decimals only when there are some", () => {
    expect(formatMoney(18_000, INR)).toBe("₹180");
    expect(formatMoney(18_050, INR)).toBe("₹180.50");
    expect(formatMoney(1_000_000, INR)).toBe("₹10,000");
  });

  it("formats TOE's whole rupees as it always did", () => {
    expect(formatMoney(180, TOE)).toBe("₹180");
    expect(formatMoney(10_000, TOE)).toBe("₹10,000");
  });

  it("formats cents and yen", () => {
    expect(formatMoney(450, USD)).toBe("$4.50");
    expect(formatMoney(400, USD)).toBe("$4");
    expect(formatMoney(5, USD)).toBe("$0.05");
    expect(formatMoney(1_200, JPY)).toMatch(/^[¥￥]1,200$/);
  });

  it("follows the locale's own way of writing money", () => {
    expect(plain(formatMoney(123_450, EUR_DE))).toBe("1.234,50 €");
    expect(formatMoney(1_500, KWD)).toMatch(/1\.500/);
  });

  it("reads a non-finite amount as zero and rounds a fraction", () => {
    expect(formatMoney(Number.NaN, USD)).toBe("$0");
    expect(formatMoney(Number.POSITIVE_INFINITY, USD)).toBe("$0");
    expect(formatMoney(449.6, USD)).toBe("$4.50");
  });
});

describe("currencySymbol", () => {
  it("is the symbol the cafe's customers see", () => {
    expect(currencySymbol(INR)).toBe("₹");
    expect(currencySymbol(TOE)).toBe("₹");
    expect(currencySymbol(USD)).toBe("$");
    expect(currencySymbol(JPY)).toMatch(/^[¥￥]$/);
    expect(currencySymbol(EUR_DE)).toBe("€");
  });
});

describe("moneyToDecimal", () => {
  it("writes a plain decimal, for the CSV and the price field", () => {
    expect(moneyToDecimal(18_050, INR)).toBe("180.50");
    expect(moneyToDecimal(18_000, INR)).toBe("180");
    expect(moneyToDecimal(18_000, INR, { padded: true })).toBe("180.00");
    expect(moneyToDecimal(5, USD, { padded: true })).toBe("0.05");
    expect(moneyToDecimal(1_200, JPY, { padded: true })).toBe("1200");
    expect(moneyToDecimal(180, TOE, { padded: true })).toBe("180");
    expect(moneyToDecimal(1_500, KWD)).toBe("1.500");
    expect(moneyToDecimal(123_450, EUR_DE)).toBe("1234.50");
  });
});

describe("parseMoneyInput", () => {
  it("reads decimals where the currency has them", () => {
    expect(parseMoneyInput("4.50", USD)).toBe(450);
    expect(parseMoneyInput("4.5", USD)).toBe(450);
    expect(parseMoneyInput("4,50", EUR_DE)).toBe(450);
    expect(parseMoneyInput(" 180 ", INR)).toBe(18_000);
    expect(parseMoneyInput("180.", INR)).toBe(18_000);
    expect(parseMoneyInput(".5", USD)).toBe(50);
    expect(parseMoneyInput("1.250", KWD)).toBe(1_250);
  });

  it("refuses more decimals than the currency has", () => {
    expect(parseMoneyInput("4.505", USD)).toBeNull();
    expect(parseMoneyInput("1200.5", JPY)).toBeNull();
    expect(parseMoneyInput("180.50", TOE)).toBeNull();
    expect(parseMoneyInput("1200", JPY)).toBe(1_200);
    expect(parseMoneyInput("180", TOE)).toBe(180);
  });

  it("refuses anything that is not a plain amount", () => {
    for (const text of ["", " ", ".", "$4", "-4", "4e2", "1,200.50", "four"]) {
      expect(parseMoneyInput(text, USD)).toBeNull();
    }
    expect(parseMoneyInput("99999999999999999999", USD)).toBeNull();
  });

  it("round-trips what moneyToDecimal writes", () => {
    for (const [amount, settings] of [
      [18_050, INR],
      [18_000, INR],
      [5, USD],
      [1_200, JPY],
      [180, TOE],
      [1_500, KWD],
    ] as const) {
      expect(parseMoneyInput(moneyToDecimal(amount, settings), settings)).toBe(
        amount,
      );
    }
  });
});

describe("defaultMaxOrderTotal", () => {
  it("is TOE's ₹10,000, in the cafe's unit", () => {
    expect(defaultMaxOrderTotal(INR)).toBe(1_000_000);
    expect(defaultMaxOrderTotal(TOE)).toBe(10_000);
  });

  it("is about US$150 elsewhere", () => {
    expect(defaultMaxOrderTotal(USD)).toBe(15_000);
    expect(defaultMaxOrderTotal(EUR_DE)).toBe(15_000);
    expect(defaultMaxOrderTotal(JPY)).toBe(20_000);
    expect(defaultMaxOrderTotal(KWD)).toBe(50_000);
  });

  it("errs generous for a currency it has no figure for", () => {
    expect(
      defaultMaxOrderTotal({
        currency: "XAF",
        locale: "fr",
        moneyUnit: "minor",
      }),
    ).toBe(1_000_000);
  });
});
