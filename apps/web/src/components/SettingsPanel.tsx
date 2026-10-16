// UX1 brief A §Build 6: the Settings content moved into a right-hand drawer
// (same ids as before J2.8), plus the three UI-only preferences (theme,
// density, dev strip) that are never sent to the server.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EffortLevel, EngagementId, EngagementView, PatchProfileBody, ProfileView } from "@workbench/core";
import { api, qk } from "../api/index.js";
import { useUiStore } from "../state/ui.js";
import { usePreferencesStore, type Density, type Theme } from "../state/preferences.js";
import { Button } from "../ui/index.js";
import "./SettingsPanel.css";

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
    mutationFn: (body: PatchProfileBody) => api.patchProfile(body),
    onSuccess: (updated) => {
      qc.setQueryData(qk.profile(), updated);
      // The engagement view carries the models new runs will use (dev strip).
      void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
    },
  });

  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const density = usePreferencesStore((s) => s.density);
  const setDensity = usePreferencesStore((s) => s.setDensity);
  const devStrip = usePreferencesStore((s) => s.devStrip);
  const setDevStrip = usePreferencesStore((s) => s.setDevStrip);

  if (!open) return null;

  const s = engagement.settings;

  return (
    <div className="drawer-overlay" onClick={close}>
      <div
        className="drawer settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>Settings</h2>
          <Button variant="ghost" size="sm" data-testid="settings-close" onClick={close}>
            Close
          </Button>
        </div>

        <div className="drawer-body">
          <section className="settings-section">
            <h3 className="label">Appearance</h3>
            <label className="settings-field">
              Theme
              <select data-testid="setting-theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="settings-field">
              Density
              <select data-testid="setting-density" value={density} onChange={(e) => setDensity(e.target.value as Density)}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label className="settings-field settings-field-checkbox">
              <input type="checkbox" data-testid="setting-dev-strip" checked={devStrip} onChange={(e) => setDevStrip(e.target.checked)} />
              Show the dev strip
            </label>
          </section>

          <section className="settings-section">
            <h3 className="label">Engagement</h3>
            <label className="settings-field">
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

            <label className="settings-field">
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

            <label className="settings-field">
              Plan changes
              <select data-testid="setting-plan-changes" value={s.planChanges} disabled>
                <option value="propose">Propose (always)</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h3 className="label">Model profile</h3>
            <label className="settings-field">
              Profile
              {profile.status === "success" && (
                <select
                  data-testid="setting-profile"
                  value={profile.data.active}
                  disabled={patchProfile.isPending}
                  onChange={(e) => patchProfile.mutate({ profile: e.target.value })}
                >
                  {profile.data.available.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {profile.status === "success" && (
              <>
                <ModelSelect role="approach" label="Approach Agent model" view={profile.data} disabled={patchProfile.isPending} onChange={(models) => patchProfile.mutate({ models })} />
                <ModelSelect role="work" label="Work agent model" view={profile.data} disabled={patchProfile.isPending} onChange={(models) => patchProfile.mutate({ models })} />
                <label className="settings-field">
                  Reasoning effort
                  <select
                    data-testid="setting-effort"
                    value={profile.data.effort}
                    disabled={patchProfile.isPending}
                    onChange={(e) => patchProfile.mutate({ effort: e.target.value as EffortLevel })}
                  >
                    {profile.data.effortChoices.map((level) => (
                      <option key={level} value={level}>
                        {EFFORT_LABELS[level]}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <p className="muted settings-helper">Applies to new sessions — the current run keeps its model and effort. Models without effort support ignore it.</p>
          </section>

          {(patch.isError || patchProfile.isError) && (
            <p role="alert" className="settings-error">
              {((patch.error ?? patchProfile.error) as Error).message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const PROFILE_DEFAULT = "";

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High (default)",
  xhigh: "Extra high",
  max: "Max",
};

function ModelSelect({
  role,
  label,
  view,
  disabled,
  onChange,
}: {
  role: "approach" | "work";
  label: string;
  view: ProfileView;
  disabled: boolean;
  onChange: (models: NonNullable<PatchProfileBody["models"]>) => void;
}) {
  return (
    <label className="settings-field">
      {label}
      <select
        data-testid={`setting-model-${role}`}
        value={view.overrides[role] ?? PROFILE_DEFAULT}
        disabled={disabled}
        onChange={(e) => onChange({ [role]: e.target.value === PROFILE_DEFAULT ? null : e.target.value })}
      >
        <option value={PROFILE_DEFAULT}>Profile default ({view.profileModels[role]})</option>
        {view.choices.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
