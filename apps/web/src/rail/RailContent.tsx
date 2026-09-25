// UX1 brief C §Build 4: the rail's body — also used, full stage, for the
// /conversation route (shell/AppShell.tsx). The shell guarantees only one
// Conversation is ever mounted at a time (it hides the rail during Kick-off
// and /conversation, which each host their own instance).

import type { EngagementId } from "@workbench/core";
import { Conversation } from "./Conversation.js";
import "./RailContent.css";

export function RailContent({ eid }: { eid: EngagementId }) {
  return (
    <div className="rail-content">
      <Conversation eid={eid} />
    </div>
  );
}
