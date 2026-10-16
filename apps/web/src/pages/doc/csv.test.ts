import { describe, expect, test } from "vitest";
import { detectDelimiter, isNumericColumn, parseCsv } from "./csv.js";

describe("detectDelimiter", () => {
  test("picks the most frequent candidate on the first line", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1,5;2,5;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
  });

  test("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('"x, y, z";b\n1;2')).toBe(";");
  });

  test("falls back to a comma for a single column", () => {
    expect(detectDelimiter("only\nvalues")).toBe(",");
  });
});

describe("parseCsv", () => {
  test("splits rows and fields, tolerating CRLF and a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("handles quoted delimiters, newlines and doubled quotes", () => {
    expect(parseCsv('name,note\n"Smith, J","said ""hi""\nthen left"')).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"\nthen left'],
    ]);
  });

  test("keeps empty fields and drops blank lines", () => {
    expect(parseCsv("a,,c\n\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  test("strips a byte-order mark", () => {
    expect(parseCsv("﻿a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("isNumericColumn", () => {
  test("accepts numbers, currency and percentages, skipping blanks", () => {
    expect(isNumericColumn(["1,200.50", "", "€ 30", "12%", "(4)"])).toBe(true);
  });

  test("rejects text and all-blank columns", () => {
    expect(isNumericColumn(["12", "n/a"])).toBe(false);
    expect(isNumericColumn(["", " "])).toBe(false);
  });
});
