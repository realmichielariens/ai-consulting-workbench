// Windows-safe path helpers used by the guard hooks and permission rules
// (ARCHITECTURE.md §15). Ported from spike/src/lib/paths.ts (M0 S2/S3).
// Normalize on `path.resolve`, forward slashes, a lowercase drive letter, no
// trailing slash, case-insensitive comparison. Browser-safe (no node: APIs
// beyond `node:path`, which bundlers polyfill or which is simply unused
// client-side; this module is still only imported from server/runtime code
// in I1, but it does not need the `/node` entry since it has no I/O).

import path from "node:path";

/**
 * Normalize a path to an absolute, forward-slash form with a lowercase
 * drive letter and no trailing slash (except for a bare root like `c:/`).
 */
export function normalize(p: string): string {
  const resolved = path.resolve(p);
  let s = resolved.split(path.sep).join("/");

  // Lowercase a leading Windows drive letter ("C:/..." -> "c:/...").
  const driveMatch = /^([A-Za-z]):(\/.*)?$/.exec(s);
  if (driveMatch) {
    const drive = driveMatch[1]!.toLowerCase();
    const rest = driveMatch[2] ?? "/";
    s = `${drive}:${rest}`;
  }

  // Strip a trailing slash, unless what's left is just a drive root
  // ("c:/") or the POSIX root ("/").
  if (s.length > 1 && s.endsWith("/")) {
    const isDriveRoot = /^[a-z]:\/$/.test(s);
    if (!isDriveRoot) {
      s = s.slice(0, -1);
    }
  }

  return s;
}

/**
 * True if `p` contains a literal `..` traversal segment (checked before
 * resolution — this is about the *input*, not the resolved result).
 */
export function hasTraversal(p: string): boolean {
  const normalizedSlashes = p.split("\\").join("/");
  const segments = normalizedSlashes.split("/");
  return segments.some((seg) => seg === "..");
}

/**
 * True if `child` is inside `parent` (or equal to it), after normalizing
 * both. Comparison is case-insensitive on win32 (and in general, since
 * drive letters and typical engagement paths are ASCII). `C:/a/bc` is NOT
 * inside `C:/a/b` (a plain-prefix bug this guards against): we require a
 * path-segment boundary.
 */
export function isInside(child: string, parent: string): boolean {
  const nChild = normalize(child);
  const nParent = normalize(parent);

  const a = nChild.toLowerCase();
  const b = nParent.toLowerCase();

  if (a === b) return true;

  const parentWithSlash = b.endsWith("/") ? b : `${b}/`;
  return a.startsWith(parentWithSlash);
}
