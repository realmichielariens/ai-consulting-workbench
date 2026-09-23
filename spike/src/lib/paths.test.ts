import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { normalize, isInside, hasTraversal } from "./paths.js";

const isWin = process.platform === "win32";

describe("normalize", () => {
  test("resolves a relative path to absolute", () => {
    const n = normalize(".");
    assert.equal(n, normalize(process.cwd()));
  });

  test("uses forward slashes", () => {
    const n = normalize("a/b/c");
    assert.ok(!n.includes("\\"), `expected no backslashes in ${n}`);
  });

  test("strips a trailing slash", () => {
    const withSlash = normalize("a/b/");
    const without = normalize("a/b");
    assert.equal(withSlash, without);
  });

  if (isWin) {
    test("lowercases the drive letter", () => {
      const n = normalize("C:/Users/x");
      assert.ok(n.startsWith("c:/"), n);
    });

    test("lowercase and uppercase drive letters normalize the same (drive only)", () => {
      assert.equal(normalize("C:/Users/x"), normalize("c:/Users/x"));
    });

    test("a bare drive root keeps its single trailing slash", () => {
      const n = normalize("C:/");
      assert.equal(n, "c:/");
    });

    test("backslashes and forward slashes normalize the same", () => {
      assert.equal(normalize("C:\\Users\\x\\y"), normalize("C:/Users/x/y"));
    });

    test("mixed slashes normalize the same", () => {
      assert.equal(normalize("C:\\Users/x\\y"), normalize("C:/Users/x/y"));
    });
  }

  test("resolves .. segments", () => {
    const n = normalize(path.join(process.cwd(), "a", "..", "b"));
    assert.equal(n, normalize(path.join(process.cwd(), "b")));
  });
});

describe("hasTraversal", () => {
  test("detects a literal .. segment (posix slashes)", () => {
    assert.equal(hasTraversal("a/../b"), true);
  });

  test("detects a literal .. segment (backslashes)", () => {
    assert.equal(hasTraversal("a\\..\\b"), true);
  });

  test("does not flag a normal path", () => {
    assert.equal(hasTraversal("a/b/c"), false);
  });

  test("does not flag a filename that merely contains dots", () => {
    assert.equal(hasTraversal("a/b..c/d"), false);
    assert.equal(hasTraversal("a/...b/c"), false);
  });

  test("detects a leading .. segment", () => {
    assert.equal(hasTraversal("../secret.txt"), true);
  });

  test("detects a trailing .. segment", () => {
    assert.equal(hasTraversal("a/b/.."), true);
  });
});

describe("isInside", () => {
  const root = isWin ? "C:/eng/items/WI-001/work" : "/eng/items/WI-001/work";
  const sibling = isWin ? "C:/eng/items/WI-002/work" : "/eng/items/WI-002/work";

  test("a path under root is inside", () => {
    assert.equal(isInside(`${root}/notes.md`, root), true);
  });

  test("a deeply nested path is inside", () => {
    assert.equal(isInside(`${root}/a/b/c.md`, root), true);
  });

  test("the same path is inside (equal counts as inside)", () => {
    assert.equal(isInside(root, root), true);
  });

  test("a sibling directory with a shared prefix is NOT inside", () => {
    // classic bug: "C:/a/bc" must not be considered inside "C:/a/b"
    const base = isWin ? "C:/eng/items/WI-001/work" : "/eng/items/WI-001/work";
    const lookalike = isWin
      ? "C:/eng/items/WI-001/workbench"
      : "/eng/items/WI-001/workbench";
    assert.equal(isInside(lookalike, base), false);
  });

  test("a sibling item is not inside", () => {
    assert.equal(isInside(sibling, root), false);
  });

  test("the parent of root is not inside root", () => {
    const parent = isWin ? "C:/eng/items/WI-001" : "/eng/items/WI-001";
    assert.equal(isInside(parent, root), false);
  });

  test("a path escaping via .. is resolved before comparison", () => {
    assert.equal(isInside(`${root}/../../WI-002/work/secret.md`, root), false);
  });

  test("a path escaping via .. back into root is inside", () => {
    assert.equal(isInside(`${root}/a/../b.md`, root), true);
  });

  if (isWin) {
    test("case-insensitive on win32", () => {
      assert.equal(
        isInside("C:/ENG/ITEMS/WI-001/WORK/notes.md", "c:/eng/items/wi-001/work"),
        true,
      );
    });

    test("mixed slash styles compare equal", () => {
      assert.equal(
        isInside("C:\\eng\\items\\WI-001\\work\\notes.md", "C:/eng/items/WI-001/work"),
        true,
      );
    });
  }

  test("outside the engagement entirely", () => {
    const engRoot = isWin ? "C:/eng" : "/eng";
    const outside = isWin ? "C:/outside/secret.txt" : "/outside/secret.txt";
    assert.equal(isInside(outside, engRoot), false);
  });
});
