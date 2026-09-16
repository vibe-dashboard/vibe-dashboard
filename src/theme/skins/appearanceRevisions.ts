import { parseAppearanceSnapshot } from "./appearanceSnapshot";

export type AppearanceMutationSource = "genesis" | "user" | "agent" | "cli" | "import" | "marketplace" | "undo" | "redo" | "revert" | "restore";
export interface AppearanceActor { readonly id: string; readonly kind: "system" | "user" | "agent" | "cli" | "import" | "marketplace" }
export interface AppearanceRevision {
  readonly revisionId: string; readonly parentRevisionId?: string; readonly targetRevisionId?: string;
  readonly snapshot: string; readonly actor: AppearanceActor; readonly source: AppearanceMutationSource;
  readonly committedAt: string; readonly summary: string; readonly integrityVersion: 1; readonly sequence: number; readonly snapshotDigest: string;
}
export interface AppearanceRevisionCheckpoint { readonly integrityVersion: 1; readonly throughRevisionId: string; readonly retainedRevisionCount: number; readonly createdAt: string; readonly digest: string }
export interface AppearanceRevisionState { readonly version: 1; readonly headRevisionId: string; readonly revisions: readonly AppearanceRevision[]; readonly checkpoint?: AppearanceRevisionCheckpoint }
export interface AppearanceRevisionStore { load(): Promise<unknown | undefined>; compareAndSwap(expectedHeadRevisionId: string | undefined, state: AppearanceRevisionState): Promise<"saved" | "stale"> }
export interface AppearanceRevisionDiagnostic { readonly code: "stale-revision" | "persistence-failed" | "unauthorized" | "invalid-snapshot" | "unknown-revision" | "nothing-to-undo"; readonly message: string; readonly expectedRevisionId?: string; readonly currentRevisionId?: string }
export type AppearanceRevisionResult = { readonly ok: true; readonly revision: AppearanceRevision } | { readonly ok: false; readonly diagnostic: AppearanceRevisionDiagnostic };

interface MutationCommand { expectedCurrentRevisionId: string; actor: AppearanceActor; summary: string }
interface ApplyCommand extends MutationCommand { snapshot: string; source: Exclude<AppearanceMutationSource, "genesis" | "undo" | "redo" | "revert" | "restore"> }
interface TargetCommand extends MutationCommand { targetRevisionId: string }

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function freezeRevision(revision: AppearanceRevision): AppearanceRevision { return Object.freeze({ ...revision, actor: Object.freeze({ ...revision.actor }) }); }
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
type RevisionFields = Omit<AppearanceRevision, "revisionId" | "snapshotDigest" | "integrityVersion">;
async function createRevision(fields: RevisionFields): Promise<AppearanceRevision> {
  const snapshotDigest = await digest(fields.snapshot);
  const integrityVersion = 1 as const;
  const revisionId = `myne-rev-v1-${await digest(JSON.stringify({ integrityVersion, sequence: fields.sequence, parentRevisionId: fields.parentRevisionId ?? null, targetRevisionId: fields.targetRevisionId ?? null, snapshotDigest, actor: fields.actor, source: fields.source, committedAt: fields.committedAt, summary: fields.summary }))}`;
  return freezeRevision({ ...fields, integrityVersion, snapshotDigest, revisionId });
}
async function createCheckpoint(fields: Omit<AppearanceRevisionCheckpoint, "integrityVersion" | "digest">, headRevisionId: string): Promise<AppearanceRevisionCheckpoint> {
  const integrityVersion = 1 as const;
  return Object.freeze({ ...fields, integrityVersion, digest: await digest(JSON.stringify({ integrityVersion, headRevisionId, ...fields })) });
}
const SOURCES = new Set<AppearanceMutationSource>(["genesis", "user", "agent", "cli", "import", "marketplace", "undo", "redo", "revert", "restore"]);
const ACTORS = new Set<AppearanceActor["kind"]>(["system", "user", "agent", "cli", "import", "marketplace"]);
const TARGET_SOURCES = new Set<AppearanceMutationSource>(["undo", "redo", "revert", "restore"]);
function hasExactKeys(value: object, keys: readonly string[]): boolean { return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"); }
async function isState(value: unknown): Promise<boolean> {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AppearanceRevisionState>;
  if (!(state.version === 1 && typeof state.headRevisionId === "string" && Array.isArray(state.revisions) && state.revisions.length > 0)
    || !hasExactKeys(state, state.checkpoint ? ["version", "headRevisionId", "revisions", "checkpoint"] : ["version", "headRevisionId", "revisions"])) return false;
  const ids = new Set<string>();
  for (let index = 0; index < state.revisions.length; index += 1) {
    const revision = state.revisions[index];
    if (!revision || typeof revision.revisionId !== "string" || ids.has(revision.revisionId) || typeof revision.snapshot !== "string"
      || typeof revision.committedAt !== "string" || Number.isNaN(Date.parse(revision.committedAt)) || typeof revision.summary !== "string"
      || revision.integrityVersion !== 1 || revision.sequence !== index || typeof revision.snapshotDigest !== "string"
      || !revision.actor || typeof revision.actor.id !== "string" || !ACTORS.has(revision.actor.kind) || !SOURCES.has(revision.source)
      || !hasExactKeys(revision.actor, ["id", "kind"]) || !hasExactKeys(revision, ["revisionId", "parentRevisionId", "targetRevisionId", "snapshot", "actor", "source", "committedAt", "summary", "integrityVersion", "sequence", "snapshotDigest"].filter((key) => (revision as unknown as Record<string, unknown>)[key] !== undefined))) return false;
    if (index === 0 ? revision.parentRevisionId !== undefined : revision.parentRevisionId !== state.revisions[index - 1]?.revisionId) return false;
    if (index === 0 ? revision.source !== "genesis" || revision.actor.kind !== "system" : revision.source === "genesis") return false;
    if (TARGET_SOURCES.has(revision.source) !== (typeof revision.targetRevisionId === "string")) return false;
    if (revision.targetRevisionId && !ids.has(revision.targetRevisionId)) return false;
    const expected = await createRevision({ sequence: revision.sequence, ...(revision.parentRevisionId ? { parentRevisionId: revision.parentRevisionId } : {}), ...(revision.targetRevisionId ? { targetRevisionId: revision.targetRevisionId } : {}), snapshot: revision.snapshot, actor: revision.actor, source: revision.source, committedAt: revision.committedAt, summary: revision.summary });
    if (expected.revisionId !== revision.revisionId || expected.snapshotDigest !== revision.snapshotDigest) return false;
    ids.add(revision.revisionId);
  }
  if (state.revisions.at(-1)?.revisionId !== state.headRevisionId) return false;
  if (state.checkpoint) {
    if (!hasExactKeys(state.checkpoint, ["integrityVersion", "throughRevisionId", "retainedRevisionCount", "createdAt", "digest"]) || !ids.has(state.checkpoint.throughRevisionId)
      || state.checkpoint.retainedRevisionCount !== state.revisions.length || Number.isNaN(Date.parse(state.checkpoint.createdAt)) || state.checkpoint.integrityVersion !== 1) return false;
    if ((await createCheckpoint({ throughRevisionId: state.checkpoint.throughRevisionId, retainedRevisionCount: state.checkpoint.retainedRevisionCount, createdAt: state.checkpoint.createdAt }, state.headRevisionId)).digest !== state.checkpoint.digest) return false;
  }
  return true;
}

export class MemoryAppearanceRevisionStore implements AppearanceRevisionStore {
  #state: unknown;
  #fail = false;
  async load(): Promise<unknown | undefined> { return this.#state === undefined ? undefined : clone(this.#state); }
  async compareAndSwap(expectedHeadRevisionId: string | undefined, state: AppearanceRevisionState): Promise<"saved" | "stale"> {
    if (this.#fail) { this.#fail = false; throw new Error("injected persistence failure"); }
    const currentHead = await isState(this.#state) ? (this.#state as AppearanceRevisionState).headRevisionId : undefined;
    if (currentHead !== expectedHeadRevisionId) return "stale";
    this.#state = clone(state); return "saved";
  }
  failNextWrite(): void { this.#fail = true; }
  corrupt(): void { this.#state = { version: 1, headRevisionId: "missing", revisions: [] }; }
}

export class AppearanceRevisionService {
  #state: AppearanceRevisionState;
  #queue: Promise<unknown> = Promise.resolve();
  private readonly store: AppearanceRevisionStore;
  private readonly clock: () => string;
  private readonly authorize: (command: { actor: AppearanceActor; source: AppearanceMutationSource }) => boolean;
  private constructor(
    store: AppearanceRevisionStore,
    state: AppearanceRevisionState,
    clock: () => string,
    authorize: (command: { actor: AppearanceActor; source: AppearanceMutationSource }) => boolean,
  ) { this.store = store; this.#state = state; this.clock = clock; this.authorize = authorize; }

  static async open(options: { store: AppearanceRevisionStore; genesisSnapshot: string; clock?: () => string; authorize?: (command: { actor: AppearanceActor; source: AppearanceMutationSource }) => boolean }): Promise<AppearanceRevisionService> {
    const loaded = await options.store.load();
    const clock = options.clock ?? (() => new Date().toISOString());
    const authorize = options.authorize ?? (() => true);
    if (loaded !== undefined) {
      if (!await isState(loaded)) throw new Error("corrupt-appearance-history");
      const validated = loaded as AppearanceRevisionState;
      if (validated.revisions.some((revision) => !parseAppearanceSnapshot(revision.snapshot).ok)) throw new Error("corrupt-appearance-history");
      const state = Object.freeze({ ...validated, revisions: Object.freeze(validated.revisions.map(freezeRevision)) });
      return new AppearanceRevisionService(options.store, state, clock, authorize);
    }
    if (!parseAppearanceSnapshot(options.genesisSnapshot).ok) throw new Error("invalid-genesis-snapshot");
    const genesis = await createRevision({ sequence: 0, snapshot: options.genesisSnapshot, actor: { id: "system", kind: "system" }, source: "genesis", committedAt: clock(), summary: "Initial appearance" });
    const state = Object.freeze({ version: 1 as const, headRevisionId: genesis.revisionId, revisions: Object.freeze([genesis]) });
    if (await options.store.compareAndSwap(undefined, state) === "stale") return AppearanceRevisionService.open(options);
    return new AppearanceRevisionService(options.store, state, clock, authorize);
  }

  inspect(): { readonly head: AppearanceRevision | undefined; readonly revisions: readonly AppearanceRevision[]; readonly checkpoint?: AppearanceRevisionCheckpoint } {
    return Object.freeze({ head: this.#state.revisions.at(-1), revisions: this.#state.revisions, ...(this.#state.checkpoint ? { checkpoint: this.#state.checkpoint } : {}) });
  }
  apply(command: ApplyCommand): Promise<AppearanceRevisionResult> { return this.#enqueue(() => this.#append(command.snapshot, command.source, command)); }
  restore(command: TargetCommand): Promise<AppearanceRevisionResult> { return this.#target("restore", command, false); }
  redo(command: TargetCommand): Promise<AppearanceRevisionResult> { return this.#target("redo", command, false); }
  revert(command: TargetCommand): Promise<AppearanceRevisionResult> { return this.#target("revert", command, true); }
  undo(command: MutationCommand & { targetRevisionId?: string }): Promise<AppearanceRevisionResult> {
    return this.#enqueue(async () => {
      const target = this.#find(command.targetRevisionId ?? this.#state.headRevisionId);
      if (!target?.parentRevisionId) return { ok: false, diagnostic: { code: "nothing-to-undo", message: "The selected revision has no prior snapshot." } };
      const previous = this.#find(target.parentRevisionId)!;
      return this.#appendNow(previous.snapshot, "undo", { ...command, targetRevisionId: target.revisionId });
    });
  }
  compact(options: { retainRecent: number }): Promise<void> {
    return this.#enqueue(async () => {
      const through = this.#state.revisions.at(Math.max(0, this.#state.revisions.length - Math.max(1, options.retainRecent) - 1));
      if (!through) return;
      const checkpoint = await createCheckpoint({ throughRevisionId: through.revisionId, retainedRevisionCount: this.#state.revisions.length, createdAt: this.clock() }, this.#state.headRevisionId);
      const next = Object.freeze({ ...this.#state, checkpoint });
      const saved = await this.store.compareAndSwap(this.#state.headRevisionId, next);
      if (saved === "stale") throw new Error("stale-revision-during-compaction");
      this.#state = next;
    });
  }
  #target(source: "restore" | "redo" | "revert", command: TargetCommand, parentSnapshot: boolean): Promise<AppearanceRevisionResult> {
    return this.#enqueue(async () => {
      const target = this.#find(command.targetRevisionId);
      if (!target || (parentSnapshot && !target.parentRevisionId)) return { ok: false, diagnostic: { code: "unknown-revision", message: "Target revision is unavailable." } };
      const selected = parentSnapshot ? this.#find(target.parentRevisionId!)! : target;
      return this.#appendNow(selected.snapshot, source, command);
    });
  }
  #append(snapshot: string, source: AppearanceMutationSource, command: MutationCommand & { targetRevisionId?: string }): Promise<AppearanceRevisionResult> { return this.#appendNow(snapshot, source, command); }
  async #appendNow(snapshot: string, source: AppearanceMutationSource, command: MutationCommand & { targetRevisionId?: string }): Promise<AppearanceRevisionResult> {
    if (!this.authorize({ actor: command.actor, source })) return { ok: false, diagnostic: { code: "unauthorized", message: "Actor is not authorized to mutate appearance." } };
    if (command.expectedCurrentRevisionId !== this.#state.headRevisionId) return { ok: false, diagnostic: { code: "stale-revision", message: "Appearance head changed; refresh and review the diff before retrying.", expectedRevisionId: command.expectedCurrentRevisionId, currentRevisionId: this.#state.headRevisionId } };
    if (!parseAppearanceSnapshot(snapshot).ok) return { ok: false, diagnostic: { code: "invalid-snapshot", message: "Mutation snapshot is invalid or non-canonical." } };
    const summary = command.summary.trim().slice(0, 240);
    const revision = await createRevision({ sequence: this.#state.revisions.length, parentRevisionId: this.#state.headRevisionId, ...(command.targetRevisionId ? { targetRevisionId: command.targetRevisionId } : {}), snapshot, actor: command.actor, source, committedAt: this.clock(), summary });
    const next = Object.freeze({ ...this.#state, headRevisionId: revision.revisionId, revisions: Object.freeze([...this.#state.revisions, revision]) });
    try {
      if (await this.store.compareAndSwap(command.expectedCurrentRevisionId, next) === "stale") {
        const latest = await this.store.load();
        if (!await isState(latest) || (latest as AppearanceRevisionState).revisions.some((item) => !parseAppearanceSnapshot(item.snapshot).ok)) {
          return { ok: false, diagnostic: { code: "persistence-failed", message: "The winning appearance history failed strict validation; the local last-known-good state remains active." } };
        }
        const validated = latest as AppearanceRevisionState;
        this.#state = Object.freeze({ ...validated, revisions: Object.freeze(validated.revisions.map(freezeRevision)) });
        const currentRevisionId = this.#state.headRevisionId;
        return { ok: false, diagnostic: { code: "stale-revision", message: "Appearance head changed; refresh and review the diff before retrying.", expectedRevisionId: command.expectedCurrentRevisionId, currentRevisionId } };
      }
    } catch { return { ok: false, diagnostic: { code: "persistence-failed", message: "Appearance history was not changed because persistence failed." } }; }
    this.#state = next; return { ok: true, revision };
  }
  #find(id: string): AppearanceRevision | undefined { return this.#state.revisions.find((revision) => revision.revisionId === id); }
  #enqueue<T>(operation: () => Promise<T>): Promise<T> { const result = this.#queue.then(operation, operation); this.#queue = result.then(() => undefined, () => undefined); return result; }
}
