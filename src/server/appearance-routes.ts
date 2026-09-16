import type { Context, Hono } from "hono";
import { diffAppearanceSnapshots } from "../theme/skins/portablePackage";
import {
  AppearanceRevisionService,
  type AppearanceActor,
  type AppearanceMutationSource,
} from "../theme/skins/appearanceRevisions";

interface AppearanceRouteOptions {
  getService: () => Promise<AppearanceRevisionService>;
  allowMutation?: (context: Context, trusted: { actor: AppearanceActor; source: "user" | "cli" | "import" }) => boolean | Promise<boolean>;
}
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
  const execute = async (context: Context, trusted: { actor: AppearanceActor; source: "user" | "cli" | "import" }) => {
    if (options.allowMutation && !await options.allowMutation(context, trusted)) return context.json({ error: "unauthorized" }, 403);
    let body: JsonRecord | undefined;
    try { body = record(await context.req.json()); } catch { body = undefined; }
    if (!body || typeof body.type !== "string" || typeof body.expectedCurrentRevisionId !== "string"
      || typeof body.summary !== "string") {
      return context.json({ error: "invalid-command" }, 400);
    }
    const actor = trusted.actor;
    const service = await options.getService();
    let result;
    if (body.type === "apply" && typeof body.snapshot === "string") {
      result = await service.apply({ expectedCurrentRevisionId: body.expectedCurrentRevisionId, snapshot: body.snapshot, actor, source: trusted.source as AppearanceMutationSource & ("user" | "cli" | "import"), summary: body.summary });
    } else if (body.type === "undo") {
      result = await service.undo({ expectedCurrentRevisionId: body.expectedCurrentRevisionId, actor, summary: body.summary, ...(typeof body.targetRevisionId === "string" ? { targetRevisionId: body.targetRevisionId } : {}) });
    } else if (["redo", "revert", "restore"].includes(body.type) && typeof body.targetRevisionId === "string") {
      const command = { expectedCurrentRevisionId: body.expectedCurrentRevisionId, targetRevisionId: body.targetRevisionId, actor, summary: body.summary };
      result = await service[body.type as "redo" | "revert" | "restore"](command);
    } else return context.json({ error: "invalid-command" }, 400);
    return result.ok ? context.json(result, 201) : context.json(result, commandStatus(result.diagnostic.code));
  };
  // CURRENT deployment assumption: the dashboard server is single-user and is
  // the authorization boundary. Caller-supplied actor/source fields are ignored.
  // Distinct trusted routes preserve audit provenance without making it an
  // authorization credential; a future multi-user host must inject principals.
  app.post("/dashboard/api/appearance/commands", (context) => execute(context, { actor: { id: "local-user", kind: "user" }, source: "user" }));
  app.post("/dashboard/api/appearance/cli-commands", (context) => execute(context, { actor: { id: "local-cli", kind: "cli" }, source: "cli" }));
  app.post("/dashboard/api/appearance/import-commands", (context) => execute(context, { actor: { id: "local-import", kind: "import" }, source: "import" }));
}
