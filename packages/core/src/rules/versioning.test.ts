import { describe, expect, it } from "vitest";
import { nextVersion, nextVersionParts } from "./versioning.js";

describe("nextVersion", () => {
  it("the first version of a slot is always 1.0, regardless of kind", () => {
    expect(nextVersion([], "material")).toBe("1.0");
    expect(nextVersion([], "minor")).toBe("1.0");
  });

  it("a minor change bumps the minor number", () => {
    expect(nextVersion([{ major: 1, minor: 0 }], "minor")).toBe("1.1");
    expect(nextVersion([{ major: 1, minor: 3 }], "minor")).toBe("1.4");
  });

  it("a material change bumps the major number and resets minor to 0", () => {
    expect(nextVersion([{ major: 1, minor: 3 }], "material")).toBe("2.0");
  });

  it("uses the latest version regardless of array order", () => {
    const existing = [
      { major: 1, minor: 0 },
      { major: 2, minor: 1 },
      { major: 1, minor: 5 },
    ];
    expect(nextVersion(existing, "minor")).toBe("2.2");
    expect(nextVersion(existing, "material")).toBe("3.0");
  });

  it("nextVersionParts returns the raw numbers", () => {
    expect(nextVersionParts([{ major: 1, minor: 0 }], "minor")).toEqual({ major: 1, minor: 1 });
  });
});
