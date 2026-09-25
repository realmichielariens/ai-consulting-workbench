// UX1 brief A §Build 7: the Engagements home ("/"), replacing StartPage.tsx.
// J1.1: list seeds and existing engagements, create or open one. J2.1: the
// headline way to start is talking to the Approach Agent.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
        <div className="home-col-h">
          <span className="label">Engagements</span>
        </div>
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
