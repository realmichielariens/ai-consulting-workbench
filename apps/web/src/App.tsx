// Top-level route switch: "/" is the Engagements home, "/e/:eid/**" mounts
// the Exhibit shell (shell/AppShell.tsx). Driven by shell/nav.ts's useEid(),
// which is reactive to both pushState navigation and back/forward.

import { useEid } from "./shell/nav.js";
import { HomePage } from "./pages/home/HomePage.js";
import { AppShell } from "./shell/AppShell.js";

export function App() {
  const eid = useEid();
  if (eid) return <AppShell eid={eid} />;
  return <HomePage />;
}
