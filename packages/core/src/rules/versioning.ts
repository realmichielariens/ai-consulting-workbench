// Version numbering (DESIGN.md §5.2, ARCHITECTURE.md §6.1). The first version
// of any slot is always 1.0, regardless of the kind the publisher claims (the
// asset registry starts empty; there is nothing to bump against). A minor
// change bumps the minor number; a material change bumps the major number
// and resets minor to 0.

import { formatVersion, type Version, type VersionKind } from "../domain.js";

export interface MajorMinor {
  major: number;
  minor: number;
}

function latestOf(existing: readonly MajorMinor[]): MajorMinor {
  return existing.reduce((latest, v) => (v.major > latest.major || (v.major === latest.major && v.minor > latest.minor) ? v : latest));
}

/** `existing` need not be sorted; only the latest (by major, then minor) matters. */
export function nextVersionParts(existing: readonly MajorMinor[], kind: VersionKind): MajorMinor {
  if (existing.length === 0) return { major: 1, minor: 0 };
  const latest = latestOf(existing);
  return kind === "minor" ? { major: latest.major, minor: latest.minor + 1 } : { major: latest.major + 1, minor: 0 };
}

export function nextVersion(existing: readonly MajorMinor[], kind: VersionKind): Version {
  const v = nextVersionParts(existing, kind);
  return formatVersion(v.major, v.minor);
}
