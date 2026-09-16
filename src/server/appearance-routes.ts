import type { Hono } from "hono";
import { diffAppearanceSnapshots } from "../theme/skins/portablePackage";
import {
  AppearanceRevisionService,
  type AppearanceActor,
  type AppearanceMutationSource,
} from "../theme/skins/appearanceRevisions";

interface AppearanceRouteOptions { getService: () => Promise<AppearanceRevisionService> }
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function commandStatus(code: string): 400 | 403 | 404 | 409 | 503 {
  if (code === "unauthorized") return 403;
  if (code === "unknown-revision" || code === "nothing-to-undo") return 404;
  if (code === "stale-revision") return 409;
  if (code === "persistence-failed") return 503;
  return 400;
}

const ACTOR_KINDS = new Set(["system", "user", "agent", "cli", "import", "marketplace"]);

export function registerAppearanceRoutes(app: Hono, options: AppearanceRouteOptions): void {
  app.get("/dashboard/api/appearance", async (context) => context.json((await options.getService()).inspect()));
  app.get("/dashboard/api/appearance/revisions/:revisionId/snapshot", async (context) => {
    const revision = (await options.getService()).inspect().revisions.find((candidate) => candidate.revisionId === context.req.param("revisionId"));
    return revision ? context.json({ revisionId: revision.revisionId, snapshot: revision.snapshot }) : context.json({ error: "unknown-revision" }, 404);
  });
  app.get("/dashboard/api/appearance/diff", async (context) => {
    const service = await options.getService();
    const revisions = service.inspect().revisions;
    const from = revisions.find((revision) => revision.revisionId === context.req.query("from"));
    const to = revisions.find((revision) => revision.revisionId === context.req.query("to"));
    if (!from || !to) return context.json({ error: "unknown-revision" }, 404);
    return context.json(diffAppearanceSnapshots(from.snapshot, to.snapshot));
  });
  app.post("/dashboard/api/appearance/commands", async (context) => {
    let body: JsonRecord | undefined;
    try { body = record(await context.req.json()); } catch { body = undefined; }
    const actorValue = record(body?.actor);
    if (!body || typeof body.type !== "string" || typeof body.expectedCurrentRevisionId !== "string"
      || typeof body.summary !== "string" || !actorValue || typeof actorValue.id !== "string" || typeof actorValue.kind !== "string"
      || !ACTOR_KINDS.has(actorValue.kind)) {
      return context.json({ error: "invalid-command" }, 400);
    }
    const actor = actorValue as unknown as AppearanceActor;
    const service = await options.getService();
    let result;
    if (body.type === "apply" && typeof body.snapshot === "string" && typeof body.source === "string"
      && ["user", "agent", "cli", "import", "marketplace"].includes(body.source)
      && body.source === actor.kind) {
      result = await service.apply({ expectedCurrentRevisionId: body.expectedCurrentRevisionId, snapshot: body.snapshot, actor, source: body.source as AppearanceMutationSource & ("user" | "agent" | "cli" | "import" | "marketplace"), summary: body.summary });
    } else if (body.type === "undo") {
      result = await service.undo({ expectedCurrentRevisionId: body.expectedCurrentRevisionId, actor, summary: body.summary, ...(typeof body.targetRevisionId === "string" ? { targetRevisionId: body.targetRevisionId } : {}) });
    } else if (["redo", "revert", "restore"].includes(body.type) && typeof body.targetRevisionId === "string") {
      const command = { expectedCurrentRevisionId: body.expectedCurrentRevisionId, targetRevisionId: body.targetRevisionId, actor, summary: body.summary };
      result = await service[body.type as "redo" | "revert" | "restore"](command);
    } else return context.json({ error: "invalid-command" }, 400);
    return result.ok ? context.json(result, 201) : context.json(result, commandStatus(result.diagnostic.code));
  });
}
