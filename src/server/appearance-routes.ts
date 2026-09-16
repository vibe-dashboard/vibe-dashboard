import type { Context, Hono } from "hono";
import { diffAppearanceSnapshots } from "../theme/skins/portablePackage";
import {
  AppearanceRevisionService,
  type AppearanceActor,
  type AppearanceMutationSource,
} from "../theme/skins/appearanceRevisions";
import { parseAppearanceSnapshot } from "../theme/skins/appearanceSnapshot";
import { verifyAppearanceCandidateBinding } from "../theme/skins/appearanceCandidate";
import type { AppearanceMutationPrincipal } from "./appearance-auth.node";

interface AppearanceRouteOptions {
  getService: () => Promise<AppearanceRevisionService>;
  authenticateMutation: (context: Context) => AppearanceMutationPrincipal | undefined | Promise<AppearanceMutationPrincipal | undefined>;
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
  const execute = async (context: Context) => {
    const principal = await options.authenticateMutation(context);
    if (!principal) return context.json({ error: "unauthorized" }, 403);
    let body: JsonRecord | undefined;
    try { body = record(await context.req.json()); } catch { body = undefined; }
    if (!body || typeof body.type !== "string" || typeof body.expectedCurrentRevisionId !== "string"
      || typeof body.summary !== "string" || "actor" in body || "source" in body
      || (body.operation !== undefined && body.operation !== "import")) {
      return context.json({ error: "invalid-command" }, 400);
    }
    const isImport = body.operation === "import";
    if (isImport && (principal.channel !== "browser" || body.type !== "apply")) return context.json({ error: "invalid-command" }, 400);
    const trusted = { actor: principal.actor, source: (isImport ? "import" : principal.channel === "cli" ? "cli" : "user") as "user" | "cli" | "import" };
    if (options.allowMutation && !await options.allowMutation(context, trusted)) return context.json({ error: "unauthorized" }, 403);
    const actor = principal.actor;
    const service = await options.getService();
    let result;
    if (body.type === "apply" && typeof body.snapshot === "string") {
      const candidate = record(body.candidate);
      if (!candidate || typeof candidate.sourceDigest !== "string" || !("artifactDigest" in candidate)
        || (candidate.artifactDigest !== null && typeof candidate.artifactDigest !== "string")) {
        return context.json({ error: "invalid-command" }, 400);
      }
      const parsed = parseAppearanceSnapshot(body.snapshot);
      if (!parsed.ok || !parsed.value) return context.json({ error: "invalid-snapshot", diagnostics: parsed.diagnostics }, 400);
      const verified = await verifyAppearanceCandidateBinding(parsed.value, {
        sourceDigest: candidate.sourceDigest as `sha256-${string}`,
        artifactDigest: candidate.artifactDigest as `sha256-${string}` | null,
      });
      if (!verified.ok) return context.json({ ok: false, diagnostic: { code: verified.code, message: verified.message } }, 409);
      result = await service.apply({ expectedCurrentRevisionId: body.expectedCurrentRevisionId, snapshot: body.snapshot, actor, source: trusted.source as AppearanceMutationSource & ("user" | "cli" | "import"), summary: body.summary });
    } else if (body.type === "undo") {
      result = await service.undo({ expectedCurrentRevisionId: body.expectedCurrentRevisionId, actor, summary: body.summary, ...(typeof body.targetRevisionId === "string" ? { targetRevisionId: body.targetRevisionId } : {}) });
    } else if (["redo", "revert", "restore"].includes(body.type) && typeof body.targetRevisionId === "string") {
      const command = { expectedCurrentRevisionId: body.expectedCurrentRevisionId, targetRevisionId: body.targetRevisionId, actor, summary: body.summary };
      result = await service[body.type as "redo" | "revert" | "restore"](command);
    } else return context.json({ error: "invalid-command" }, 400);
    return result.ok ? context.json(result, 201) : context.json(result, commandStatus(result.diagnostic.code));
  };
  app.post("/dashboard/api/appearance/commands", execute);
}
