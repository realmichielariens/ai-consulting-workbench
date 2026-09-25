// Minimal agenda (I2, domain.ts AgendaItem, schema.ts `agenda_items`): a
// routed question gets one row (QuestionRouted). The board and its behaviour
// arrive in I5; I2 only needs to create and read rows.

import { eq } from "drizzle-orm";
import { AgendaItem, type AgendaId, type IsoTime, type ItemId, type ProposalId, type RequestId } from "@workbench/core";
import type { Db } from "../client.js";
import { agendaItems } from "../schema.js";
import { parseJsonColumn, toEpochMs, toIsoTime, toJsonColumn } from "../mappers.js";

const LinksSchema = AgendaItem.shape.links;

function mapRow(row: typeof agendaItems.$inferSelect): AgendaItem {
  return AgendaItem.parse({
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    links: parseJsonColumn("links", row.links, LinksSchema),
    createdAt: toIsoTime(row.createdAt),
    resolution: row.resolution,
  });
}

export interface CreateAgendaItemInput {
  id: AgendaId;
  kind: AgendaItem["kind"];
  title: string;
  status: AgendaItem["status"];
  links: { items?: ItemId[]; requests?: RequestId[]; proposals?: ProposalId[] };
  createdAt: IsoTime;
}

export function createAgendaItem(ctx: Db, input: CreateAgendaItemInput): AgendaItem {
  const links = LinksSchema.parse(input.links);
  ctx.db
    .insert(agendaItems)
    .values({
      id: input.id,
      kind: input.kind,
      title: input.title,
      status: input.status,
      links: toJsonColumn(links, LinksSchema),
      resolution: null,
      createdAt: toEpochMs(input.createdAt),
    })
    .run();
  const row = getAgendaItem(ctx, input.id);
  if (!row) throw new Error(`createAgendaItem: row for ${input.id} vanished after insert`);
  return row;
}

export function getAgendaItem(ctx: Db, id: AgendaId): AgendaItem | null {
  const row = ctx.db.select().from(agendaItems).where(eq(agendaItems.id, id)).get();
  return row ? mapRow(row) : null;
}

export function listAgendaItems(ctx: Db): AgendaItem[] {
  return ctx.db.select().from(agendaItems).all().map(mapRow);
}
