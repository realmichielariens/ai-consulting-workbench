// J1.1: list seeds and existing engagements, create or open one.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "../api/index.js";
import { openEngagement } from "../state/url.js";

export function StartPage() {
  const queryClient = useQueryClient();
  const seeds = useQuery({ queryKey: qk.seeds(), queryFn: () => api.listSeeds() });
  const engagements = useQuery({ queryKey: qk.engagements(), queryFn: () => api.listEngagements() });
  const [names, setNames] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: (vars: { seedId: string; name: string }) => api.createEngagement(vars),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: qk.engagements() });
      openEngagement(summary.id);
    },
  });

  return (
    <main className="start-page">
      <h1>Agentic Project Workbench</h1>

      <section aria-labelledby="seeds-heading">
        <h2 id="seeds-heading">Start a new engagement</h2>
        {seeds.status === "pending" && <p>Loading seeds…</p>}
        {seeds.status === "error" && <p role="alert">Could not load seeds: {(seeds.error as Error).message}</p>}
        <ul className="card-list">
          {seeds.data?.map((seed) => {
            const name = names[seed.id] ?? seed.engagementName;
            return (
              <li key={seed.id} className="card" data-testid="seed-card" data-seed-id={seed.id}>
                <h3>{seed.title}</h3>
                <p>{seed.description}</p>
                <p className="muted">{seed.itemCount} items</p>
                <label>
                  Engagement name
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setNames((prev) => ({ ...prev, [seed.id]: e.target.value }))}
                    data-testid="engagement-name-input"
                  />
                </label>
                <button
                  type="button"
                  data-testid="create-engagement-button"
                  disabled={create.isPending || name.trim().length === 0}
                  onClick={() => create.mutate({ seedId: seed.id, name: name.trim() })}
                >
                  Create
                </button>
                {create.isPending && create.variables?.seedId === seed.id && <p className="pending">Creating…</p>}
                {create.isError && create.variables?.seedId === seed.id && (
                  <p role="alert" className="error">
                    Failed: {(create.error as Error).message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="engagements-heading">
        <h2 id="engagements-heading">Existing engagements</h2>
        {engagements.status === "pending" && <p>Loading…</p>}
        {engagements.status === "error" && <p role="alert">Could not load engagements: {(engagements.error as Error).message}</p>}
        {engagements.data?.length === 0 && <p className="muted">None yet — create one above.</p>}
        <ul className="card-list">
          {engagements.data?.map((eng) => (
            <li key={eng.id} className="card" data-testid="engagement-card" data-engagement-id={eng.id}>
              <h3>{eng.name}</h3>
              <p className="muted">
                Plan v{eng.planVersion} · ${eng.costUsd.toFixed(2)} spent
              </p>
              <button type="button" data-testid="open-engagement-button" onClick={() => openEngagement(eng.id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
