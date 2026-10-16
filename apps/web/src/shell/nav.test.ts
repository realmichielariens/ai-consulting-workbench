// UX1 brief A §Build 3: round trips between the open* builders and
// parseStageRoute, plus the legacy query-param redirects (plan §4.3).

import { beforeEach, describe, expect, test } from "vitest";
import {
  legacyRedirectPath,
  openDoc,
  openDocuments,
  openHome,
  openItem,
  openJournal,
  openPlan,
  openConversation,
  parseStageRoute,
} from "./nav.js";

function current(): string {
  return window.location.pathname + window.location.search;
}

beforeEach(() => {
  window.history.pushState(null, "", "/");
});

describe("parseStageRoute", () => {
  test("bare engagement path is the home page", () => {
    expect(parseStageRoute("/e/acme")).toEqual({ page: "home", eid: "acme" });
  });

  test("non-engagement paths parse to none", () => {
    expect(parseStageRoute("/")).toEqual({ page: "none" });
    expect(parseStageRoute("/other")).toEqual({ page: "none" });
  });
});

describe("open* / parseStageRoute round trips", () => {
  test("openHome", () => {
    openHome("acme");
    expect(parseStageRoute(current())).toEqual({ page: "home", eid: "acme" });
  });

  test("openPlan with no options defaults to canvas, no selection", () => {
    openPlan("acme");
    expect(parseStageRoute(current())).toEqual({ page: "plan", eid: "acme", view: "canvas", sel: null, preview: null });
  });

  test("openPlan round-trips view/sel/preview", () => {
    openPlan("acme", { view: "tracker", sel: "WI-004", preview: "PR-7" });
    expect(parseStageRoute(current())).toEqual({ page: "plan", eid: "acme", view: "tracker", sel: "WI-004", preview: "PR-7" });
  });

  test("openDocuments", () => {
    openDocuments("acme");
    expect(parseStageRoute(current())).toEqual({ page: "documents", eid: "acme" });
  });

  test("openItem with no options defaults to the activity tab, no run", () => {
    openItem("acme", "WI-004");
    expect(parseStageRoute(current())).toEqual({ page: "item", eid: "acme", itemId: "WI-004", tab: "activity", run: null });
  });

  test("openItem round-trips tab/run", () => {
    openItem("acme", "WI-004", { tab: "worklog", run: "R-1" });
    expect(parseStageRoute(current())).toEqual({ page: "item", eid: "acme", itemId: "WI-004", tab: "worklog", run: "R-1" });
  });

  test("openDoc with no version (latest)", () => {
    openDoc("acme", "WI-004/themes");
    expect(parseStageRoute(current())).toEqual({ page: "doc", eid: "acme", itemId: "WI-004", slot: "themes", version: null });
  });

  test("openDoc round-trips the version", () => {
    openDoc("acme", "WI-004/themes", "2.0");
    expect(parseStageRoute(current())).toEqual({ page: "doc", eid: "acme", itemId: "WI-004", slot: "themes", version: "2.0" });
  });

  test("openJournal", () => {
    openJournal("acme");
    expect(parseStageRoute(current())).toEqual({ page: "journal", eid: "acme" });
  });

  test("openConversation", () => {
    openConversation("acme");
    expect(parseStageRoute(current())).toEqual({ page: "conversation", eid: "acme" });
  });
});

describe("legacyRedirectPath", () => {
  test("?item=X redirects to /item/X", () => {
    expect(legacyRedirectPath("/e/acme?item=WI-004")).toBe("/e/acme/item/WI-004");
  });

  test("?asset=I/s&v=V redirects to /doc/I/s/V", () => {
    expect(legacyRedirectPath("/e/acme?asset=WI-004/themes&v=2.0")).toBe("/e/acme/doc/WI-004/themes/2.0");
  });

  test("?asset=I/s with no version redirects without a version segment", () => {
    expect(legacyRedirectPath("/e/acme?asset=WI-004/themes")).toBe("/e/acme/doc/WI-004/themes");
  });

  test("no legacy params: no redirect", () => {
    expect(legacyRedirectPath("/e/acme")).toBeNull();
  });

  test("run=R alone is left to useLegacyRedirect (needs the plan to resolve the item)", () => {
    expect(legacyRedirectPath("/e/acme?run=R-1")).toBeNull();
  });

  test("only applies on the bare engagement path", () => {
    expect(legacyRedirectPath("/e/acme/plan?item=WI-004")).toBeNull();
  });
});
