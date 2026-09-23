// Top-level route switch, driven by the tiny URL-state module (state/url.ts):
// "/" is the start page (J1.1), "/e/:eid" is an open engagement.

import { useRoute } from "./state/url.js";
import { StartPage } from "./components/StartPage.js";
import { EngagementLayout } from "./components/EngagementLayout.js";

export function App() {
  const route = useRoute();
  if (route.view === "engagement" && route.eid) return <EngagementLayout eid={route.eid} />;
  return <StartPage />;
}
