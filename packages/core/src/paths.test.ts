import { describe, expect, test } from "vitest";
import path from "node:path";
import { normalize, isInside, hasTraversal } from "./paths.js";

const isWin = process.platform === "win32";

describe("normalize", () => {
  test("resolves a relative path to absolute", () => {
    const n = normalize(".");
    expect(n).toBe(normalize(process.cwd()));
  });

  test("uses forward slashes", () => {
    const n = normalize("a/b/c");
    expect(n.includes("\\")).toBe(false);
  });

  test("strips a trailing slash", () => {
    const withSlash = normalize("a/b/");
    const without = normalize("a/b");
    expect(withSlash).toBe(without);
  });

  test.runIf(isWin)("lowercases the drive letter", () => {
    const n = normalize("C:/Users/x");
    expect(n.startsWith("c:/")).toBe(true);
  });

  test.runIf(isWin)("lowercase and uppercase drive letters normalize the same (drive only)", () => {
    expect(normalize("C:/Users/x")).toBe(normalize("c:/Users/x"));
  });

  test.runIf(isWin)("a bare drive root keeps its single trailing slash", () => {
    const n = normalize("C:/");
    expect(n).toBe("c:/");
  });

  test.runIf(isWin)("backslashes and forward slashes normalize the same", () => {
    expect(normalize("C:\\Users\\x\\y")).toBe(normalize("C:/Users/x/y"));
  });

  test.runIf(isWin)("mixed slashes normalize the same", () => {
    expect(normalize("C:\\Users/x\\y")).toBe(normalize("C:/Users/x/y"));
  });

  test("resolves .. segments", () => {
    const n = normalize(path.join(process.cwd(), "a", "..", "b"));
    expect(n).toBe(normalize(path.join(process.cwd(), "b")));
  });
});

describe("hasTraversal", () => {
  test("detects a literal .. segment (posix slashes)", () => {
    expect(hasTraversal("a/../b")).toBe(true);
  });

  test("detects a literal .. segment (backslashes)", () => {
    expect(hasTraversal("a\\..\\b")).toBe(true);
  });

  test("does not flag a normal path", () => {
    expect(hasTraversal("a/b/c")).toBe(false);
  });

  test("does not flag a filename that merely contains dots", () => {
    expect(hasTraversal("a/b..c/d")).toBe(false);
    expect(hasTraversal("a/...b/c")).toBe(false);
  });

  test("detects a leading .. segment", () => {
    expect(hasTraversal("../secret.txt")).toBe(true);
  });

  test("detects a trailing .. segment", () => {
    expect(hasTraversal("a/b/..")).toBe(true);
  });
});

describe("isInside", () => {
  const root = isWin ? "C:/eng/items/WI-001/work" : "/eng/items/WI-001/work";
  const sibling = isWin ? "C:/eng/items/WI-002/work" : "/eng/items/WI-002/work";

  test("a path under root is inside", () => {
    expect(isInside(`${root}/notes.md`, root)).toBe(true);
  });

  test("a deeply nested path is inside", () => {
    expect(isInside(`${root}/a/b/c.md`, root)).toBe(true);
  });

  test("the same path is inside (equal counts as inside)", () => {
    expect(isInside(root, root)).toBe(true);
  });

  test("a sibling directory with a shared prefix is NOT inside", () => {
    // classic bug: "C:/a/bc" must not be considered inside "C:/a/b"
    const base = isWin ? "C:/eng/items/WI-001/work" : "/eng/items/WI-001/work";
    const lookalike = isWin ? "C:/eng/items/WI-001/workbench" : "/eng/items/WI-001/workbench";
    expect(isInside(lookalike, base)).toBe(false);
  });

  test("a sibling item is not inside", () => {
    expect(isInside(sibling, root)).toBe(false);
  });

  test("the parent of root is not inside root", () => {
    const parent = isWin ? "C:/eng/items/WI-001" : "/eng/items/WI-001";
    expect(isInside(parent, root)).toBe(false);
  });

  test("a path escaping via .. is resolved before comparison", () => {
    expect(isInside(`${root}/../../WI-002/work/secret.md`, root)).toBe(false);
  });

  test("a path escaping via .. back into root is inside", () => {
    expect(isInside(`${root}/a/../b.md`, root)).toBe(true);
  });

  test.runIf(isWin)("case-insensitive on win32", () => {
    expect(isInside("C:/ENG/ITEMS/WI-001/WORK/notes.md", "c:/eng/items/wi-001/work")).toBe(true);
  });

  test.runIf(isWin)("mixed slash styles compare equal", () => {
    expect(isInside("C:\\eng\\items\\WI-001\\work\\notes.md", "C:/eng/items/WI-001/work")).toBe(true);
  });

  test("outside the engagement entirely", () => {
    const engRoot = isWin ? "C:/eng" : "/eng";
    const outside = isWin ? "C:/outside/secret.txt" : "/outside/secret.txt";
    expect(isInside(outside, engRoot)).toBe(false);
  });
});
