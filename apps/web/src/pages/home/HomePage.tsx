// UX1 brief A §Build 7: the Engagements home ("/"), replacing StartPage.tsx.
// J1.1: list seeds and existing engagements, create or open one. J2.1: the
// headline way to start is talking to the Approach Agent.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EngagementId } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openHome } from "../../shell/nav.js";
import { useApplyPreferences } from "../../state/preferences.js";
import { Button, HarveyBall, harveyFromRatio } from "../../ui/index.js";
import "./HomePage.css";

const BLANK_SEED_ID = "blank";

export function HomePage() {
  useApplyPreferences();

  const queryClient = useQueryClient();
  const seeds = useQuery({ queryKey: qk.seeds(), queryFn: () => api.listSeeds() });
  const engagements = useQuery({ queryKey: qk.engagements(), queryFn: () => api.listEngagements() });
  const [names, setNames] = useState<Record<string, string>>({});
  const [approachName, setApproachName] = useState("New engagement");

  const create = useMutation({
    mutationFn: (vars: { seedId: string; name: string }) => api.createEngagement(vars),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: qk.engagements() });
      openHome(summary.id);
    },
  });

  const [selected, setSelected] = useState<ReadonlySet<EngagementId>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Sequential, collecting failures: one refused delete (an agent still running) must not stop the rest.
  const remove = useMutation({
    mutationFn: async (ids: EngagementId[]) => {
      const failed: { id: EngagementId; message: string }[] = [];
      for (const id of ids) {
        try {
          await api.deleteEngagement(id);
        } catch (err) {
          failed.push({ id, message: (err as Error).message });
        }
      }
      return failed;
    },
    onSuccess: (failed) => {
      setSelected(new Set(failed.map((f) => f.id)));
      setConfirmingDelete(false);
      void queryClient.invalidateQueries({ queryKey: qk.engagements() });
    },
  });

  // Only ids still listed count (another tab may have deleted some).
  const selectedIds = engagements.data?.filter((e) => selected.has(e.id)).map((e) => e.id) ?? [];
  const allSelected = engagements.data !== undefined && engagements.data.length > 0 && selectedIds.length === engagements.data.length;
  const toggle = (id: EngagementId) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleSeeds = seeds.data?.filter((s) => s.id !== BLANK_SEED_ID) ?? [];

  return (
    <main className="home-page">
      <h1 className="home-title">Agentic Project Workbench</h1>

      <section aria-labelledby="approach-heading" className="home-approach">
        <span className="label">Start</span>
        <h2 id="approach-heading">Start with the Approach Agent</h2>
        <p className="muted">Describe the engagement in conversation; the Approach Agent shapes the context, stakeholders and plan with you.</p>
        <div className="home-approach-form">
          <label className="home-field">
            Engagement name
            <input type="text" value={approachName} onChange={(e) => setApproachName(e.target.value)} data-testid="approach-name-input" />
          </label>
          <Button
            variant="primary"
            data-testid="start-with-approach"
            disabled={create.isPending || approachName.trim().length === 0}
            onClick={() => create.mutate({ seedId: BLANK_SEED_ID, name: approachName.trim() })}
          >
            Start with the Approach Agent
          </Button>
        </div>
        {create.isPending && create.variables?.seedId === BLANK_SEED_ID && <p className="muted">Creating…</p>}
        {create.isError && create.variables?.seedId === BLANK_SEED_ID && (
          <p role="alert" className="home-error">
            Failed: {(create.error as Error).message}
          </p>
        )}
      </section>

      <section aria-labelledby="engagements-heading">
        <div className="home-col-h home-col-h-bar">
          <span className="label">Engagements</span>
          {selectedIds.length > 0 && !confirmingDelete && (
            <Button variant="danger" size="sm" data-testid="delete-engagements-button" onClick={() => setConfirmingDelete(true)}>
              Delete selected ({selectedIds.length})
            </Button>
          )}
        </div>
        {confirmingDelete && selectedIds.length > 0 && (
          <div className="home-confirm" role="alertdialog" aria-label="Confirm delete" data-testid="delete-engagements-confirm">
            <p>
              Permanently delete {selectedIds.length === 1 ? "this engagement" : `these ${selectedIds.length} engagements`}? Their plan, outputs, conversation and history
              are removed from disk. This cannot be undone.
            </p>
            <div className="home-confirm-actions">
              <Button variant="danger" size="sm" data-testid="delete-engagements-confirm-button" disabled={remove.isPending} onClick={() => remove.mutate(selectedIds)}>
                {remove.isPending ? "Deleting…" : "Delete permanently"}
              </Button>
              <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {remove.data && remove.data.length > 0 && (
          <div role="alert" className="home-error">
            {remove.data.map((f) => (
              <p key={f.id}>
                Could not delete {f.id}: {f.message}
              </p>
            ))}
          </div>
        )}
        {engagements.status === "pending" && <p className="muted">Loading…</p>}
        {engagements.status === "error" && (
          <p role="alert" className="home-error">
            Could not load engagements: {(engagements.error as Error).message}
          </p>
        )}
        {engagements.data?.length === 0 && <p className="muted">None yet — create one above.</p>}
        {engagements.data && engagements.data.length > 0 && (
          <table className="tracker home-portfolio">
            <thead>
              <tr>
                <th className="home-select">
                  <input
                    type="checkbox"
                    aria-label="Select all engagements"
                    data-testid="select-all-engagements"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(engagements.data.map((e) => e.id)))}
                  />
                </th>
                <th>Engagement</th>
                <th>Progress</th>
                <th>Needs you</th>
                <th className="tracker-r">Spend</th>
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {engagements.data.map((eng) => (
                <tr key={eng.id} className="tracker-clickable" data-testid="engagement-card" data-engagement-id={eng.id} onClick={() => openHome(eng.id)}>
                  <td className="home-select" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${eng.name}`} data-testid="select-engagement" checked={selected.has(eng.id)} onChange={() => toggle(eng.id)} />
                  </td>
                  <td>
                    <b>{eng.name}</b>
                    <div className="id">plan v{eng.planVersion}</div>
                  </td>
                  <td>
                    <HarveyBall quarters={harveyFromRatio(eng.progress.done, eng.progress.total)} /> {eng.progress.done} / {eng.progress.total}
                  </td>
                  <td>{eng.inboxCount}</td>
                  <td className="tracker-r">${eng.costUsd.toFixed(2)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="open-engagement-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openHome(eng.id);
                      }}
                    >
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="seeds-heading">
        <div className="home-col-h">
          <span className="label">Start from a seed</span>
        </div>
        {seeds.status === "pending" && <p className="muted">Loading seeds…</p>}
        {seeds.status === "error" && (
          <p role="alert" className="home-error">
            Could not load seeds: {(seeds.error as Error).message}
          </p>
        )}
        <ul className="home-seed-list">
          {visibleSeeds.map((seed) => {
            const name = names[seed.id] ?? seed.engagementName;
            return (
              <li key={seed.id} className="card" data-testid="seed-card" data-seed-id={seed.id}>
                <h3 className="card-title">{seed.title}</h3>
                <p>{seed.description}</p>
                <p className="muted">{seed.itemCount} items</p>
                <label className="home-field">
                  Engagement name
                  <input type="text" value={name} onChange={(e) => setNames((prev) => ({ ...prev, [seed.id]: e.target.value }))} data-testid="engagement-name-input" />
                </label>
                <div className="card-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="create-engagement-button"
                    disabled={create.isPending || name.trim().length === 0}
                    onClick={() => create.mutate({ seedId: seed.id, name: name.trim() })}
                  >
                    Create
                  </Button>
                </div>
                {create.isPending && create.variables?.seedId === seed.id && <p className="muted">Creating…</p>}
                {create.isError && create.variables?.seedId === seed.id && (
                  <p role="alert" className="home-error">
                    Failed: {(create.error as Error).message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
