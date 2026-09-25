// J2.8: per-engagement settings (question handling, item start, plan
// changes) and the workspace-wide model profile (applies to new Approach
// Agent / Work Agent sessions only, not the current run).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EngagementId, EngagementView } from "@workbench/core";
import { api, qk } from "../api/index.js";
import { useUiStore } from "../state/ui.js";

export function SettingsPanel({ eid, engagement }: { eid: EngagementId; engagement: EngagementView }) {
  const open = useUiStore((s) => s.settingsOpen);
  const close = useUiStore((s) => s.closeSettings);
  const qc = useQueryClient();

  const patch = useMutation({
    mutationFn: (changes: Partial<EngagementView["settings"]>) => api.patchSettings(eid, changes),
    onSuccess: (updated) => qc.setQueryData(qk.engagement(eid), updated),
  });

  const profile = useQuery({ queryKey: qk.profile(), queryFn: () => api.getProfile() });
  const patchProfile = useMutation({
    mutationFn: (p: string) => api.patchProfile({ profile: p }),
    onSuccess: (updated) => qc.setQueryData(qk.profile(), updated),
  });

  if (!open) return null;

  const s = engagement.settings;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-panel">
      <div className="modal">
        <h2>Settings</h2>

        <label>
          Question handling
          <select
            data-testid="setting-question-handling"
            value={s.questionHandling}
            disabled={patch.isPending}
            onChange={(e) => patch.mutate({ questionHandling: e.target.value as "aa-first" | "always-human" })}
          >
            <option value="aa-first">Approach Agent first</option>
            <option value="always-human">Always human</option>
          </select>
        </label>

        <label>
          Item start
          <select
            data-testid="setting-item-start"
            value={s.itemStart}
            disabled={patch.isPending}
            onChange={(e) => patch.mutate({ itemStart: e.target.value as "manual" | "auto" })}
          >
            <option value="manual">Manual</option>
            <option value="auto">Auto</option>
          </select>
        </label>

        <label>
          Plan changes
          <select data-testid="setting-plan-changes" value={s.planChanges} disabled>
            <option value="propose">Propose (always)</option>
          </select>
        </label>

        <label>
          Model profile
          {profile.status === "success" && (
            <select
              data-testid="setting-profile"
              value={profile.data.active}
              disabled={patchProfile.isPending}
              onChange={(e) => patchProfile.mutate(e.target.value)}
            >
              {profile.data.available.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <span className="helper-text">Applies to new sessions — the current run keeps its model.</span>
        </label>

        <div className="actions">
          <button type="button" data-testid="settings-close" onClick={close}>
            Close
          </button>
        </div>
        {patch.isError && (
          <p role="alert" className="error">
            {(patch.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
