import { describe, expect, it } from "vitest";

import { detectDelimiter, parseCsv, toCsv } from "../csv.ts";

const cells = (text: string) => parseCsv(text).map((r) => r.cells);

describe("parseCsv", () => {
  it("reads plain rows, with or without a final line break", () => {
    expect(cells("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(cells("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas, quotes and line breaks inside quoted cells", () => {
    expect(
      cells(
        'name,description\n"Salt, Caramel Latte","The ""good"" one"\n"Two\nlines",x\n',
      ),
    ).toEqual([
      ["name", "description"],
      ["Salt, Caramel Latte", 'The "good" one'],
      ["Two\nlines", "x"],
    ]);
  });

  it("drops a UTF-8 byte-order mark", () => {
    const [header] = parseCsv("﻿name,price\nTea,3\n");
    expect(header.cells).toEqual(["name", "price"]);
    expect(header.start).toBe(1);
  });

  it("reads Windows and old-Mac line endings, inside quotes too", () => {
    expect(cells('a,b\r\n"x\r\ny",2\r\n')).toEqual([
      ["a", "b"],
      ["x\ny", "2"],
    ]);
    expect(cells("a,b\r1,2\r")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("numbers rows as a spreadsheet does, blank ones included", () => {
    const rows = parseCsv("name\n\nTea\n");
    expect(rows.map((r) => [r.row, r.cells])).toEqual([
      [1, ["name"]],
      [2, [""]],
      [3, ["Tea"]],
    ]);
  });

  it("knows where each row is in the text", () => {
    const text = 'name\r\n"Tea, hot",3\r\nCake,4';
    expect(parseCsv(text).map((r) => text.slice(r.start, r.end))).toEqual([
      "name",
      '"Tea, hot",3',
      "Cake,4",
    ]);
  });

  it("takes a quote after spaces as the cell's opening quote", () => {
    expect(cells('a, "b, c"')).toEqual([["a", " b, c"]]);
  });
});

describe("detectDelimiter", () => {
  it("finds tabs, as a spreadsheet copies cells", () => {
    expect(detectDelimiter("name\tprice\nTea, hot\t3,50\n")).toBe("\t");
  });

  it("finds semicolons, as Excel writes CSV where a comma is the decimal", () => {
    expect(detectDelimiter("name;price\nTee;3,50\n")).toBe(";");
    expect(cells("name;price\nTee;3,50\n")).toEqual([
      ["name", "price"],
      ["Tee", "3,50"],
    ]);
  });

  it("defaults to commas, and skips a leading blank line", () => {
    expect(detectDelimiter("name,price\n")).toBe(",");
    expect(detectDelimiter("\n\nname;price\n")).toBe(";");
    expect(detectDelimiter("")).toBe(",");
  });
});

describe("toCsv", () => {
  it("quotes only what needs it, and reads back the same", () => {
    const rows = [
      ["name", "description"],
      ["Mocha", 'Dark "70%" chocolate, milk'],
      ["Plain", "Line\nbreak"],
    ];
    const text = toCsv(rows);
    expect(text.split("\n")[1]).toBe('Mocha,"Dark ""70%"" chocolate, milk"');
    expect(cells(text)).toEqual(rows);
  });
});
