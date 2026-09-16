import { parseAppearanceSnapshot } from "./appearanceSnapshot";
import { sourceDigestForAppearanceSnapshot } from "./appearanceSourceDigest";

export type AppearanceMutationSource = "genesis" | "user" | "agent" | "cli" | "import" | "marketplace" | "undo" | "redo" | "revert" | "restore";
export interface AppearanceActor { readonly id: string; readonly kind: "system" | "user" | "agent" | "cli" | "import" | "marketplace" }
export interface AppearanceRevision {
  readonly revisionId: string; readonly parentRevisionId?: string; readonly targetRevisionId?: string;
  readonly streamId: string; readonly ownerId: string;
  readonly snapshot: string; readonly actor: AppearanceActor; readonly source: AppearanceMutationSource;
  readonly committedAt: string; readonly summary: string; readonly integrityVersion: 1; readonly sequence: number; readonly snapshotDigest: string;
  readonly activation: AppearanceActivationRecord;
}
export interface AppearanceActivationRecord { readonly sourceDigest: string; readonly artifactDigest: string | null; readonly compilerVersion: 1; readonly policyVersion: 1 }
export interface AppearanceRevisionCheckpoint { readonly integrityVersion: 1; readonly throughRevisionId: string; readonly boundarySnapshot: string; readonly boundarySnapshotDigest: string; readonly retainedRevisionCount: number; readonly rangeStartedAt: string; readonly rangeEndedAt: string; readonly auditSummary: Readonly<Record<string, number>>; readonly retainedRoots: readonly string[]; readonly createdAt: string; readonly digest: string }
export interface AppearanceRetentionPolicy { readonly mode: "retain-all"; readonly undoWindow: null; readonly assetGc: "disabled" }
export interface AppearanceRevisionState { readonly version: 1; readonly streamId: string; readonly ownerId: string; readonly retention: AppearanceRetentionPolicy; readonly headRevisionId: string; readonly revisions: readonly AppearanceRevision[]; readonly checkpoint?: AppearanceRevisionCheckpoint }
export interface AppearanceRevisionStore { load(): Promise<unknown | undefined>; compareAndSwap(expectedHeadRevisionId: string | undefined, state: AppearanceRevisionState): Promise<"saved" | "stale"> }
export interface AppearanceRevisionDiagnostic { readonly code: "stale-revision" | "persistence-failed" | "unauthorized" | "invalid-snapshot" | "unknown-revision" | "nothing-to-undo"; readonly message: string; readonly expectedRevisionId?: string; readonly currentRevisionId?: string }
export type AppearanceRevisionResult = { readonly ok: true; readonly revision: AppearanceRevision } | { readonly ok: false; readonly diagnostic: AppearanceRevisionDiagnostic };

interface MutationCommand { expectedCurrentRevisionId: string; actor: AppearanceActor; summary: string; activation?: AppearanceActivationRecord }
interface ApplyCommand extends MutationCommand { snapshot: string; source: Exclude<AppearanceMutationSource, "genesis" | "undo" | "redo" | "revert" | "restore">; activation?: AppearanceActivationRecord }
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
  const revisionId = `myne-rev-v1-${await digest(JSON.stringify({ integrityVersion, streamId: fields.streamId, ownerId: fields.ownerId, sequence: fields.sequence, parentRevisionId: fields.parentRevisionId ?? null, targetRevisionId: fields.targetRevisionId ?? null, snapshotDigest, activation: fields.activation, actor: fields.actor, source: fields.source, committedAt: fields.committedAt, summary: fields.summary }))}`;
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
  if (!(state.version === 1 && typeof state.streamId === "string" && typeof state.ownerId === "string" && typeof state.headRevisionId === "string" && Array.isArray(state.revisions) && state.revisions.length > 0)
    || !state.retention || !hasExactKeys(state.retention, ["mode", "undoWindow", "assetGc"]) || state.retention.mode !== "retain-all" || state.retention.undoWindow !== null || state.retention.assetGc !== "disabled"
    || !hasExactKeys(state, state.checkpoint ? ["version", "streamId", "ownerId", "retention", "headRevisionId", "revisions", "checkpoint"] : ["version", "streamId", "ownerId", "retention", "headRevisionId", "revisions"])) return false;
  const ids = new Set<string>();
  for (let index = 0; index < state.revisions.length; index += 1) {
    const revision = state.revisions[index];
    if (!revision || typeof revision.revisionId !== "string" || ids.has(revision.revisionId) || typeof revision.snapshot !== "string"
      || typeof revision.committedAt !== "string" || Number.isNaN(Date.parse(revision.committedAt)) || typeof revision.summary !== "string"
      || revision.integrityVersion !== 1 || revision.sequence !== index || typeof revision.snapshotDigest !== "string"
      || revision.streamId !== state.streamId || revision.ownerId !== state.ownerId
      || !revision.activation || typeof revision.activation.sourceDigest !== "string" || (revision.activation.artifactDigest !== null && typeof revision.activation.artifactDigest !== "string")
      || revision.activation.compilerVersion !== 1 || revision.activation.policyVersion !== 1 || !hasExactKeys(revision.activation, ["sourceDigest", "artifactDigest", "compilerVersion", "policyVersion"])
      || !revision.actor || typeof revision.actor.id !== "string" || !ACTORS.has(revision.actor.kind) || !SOURCES.has(revision.source)
      || !hasExactKeys(revision.actor, ["id", "kind"]) || !hasExactKeys(revision, ["revisionId", "parentRevisionId", "targetRevisionId", "streamId", "ownerId", "snapshot", "actor", "source", "committedAt", "summary", "integrityVersion", "sequence", "snapshotDigest", "activation"].filter((key) => (revision as unknown as Record<string, unknown>)[key] !== undefined))) return false;
    if (index === 0 ? revision.parentRevisionId !== undefined : revision.parentRevisionId !== state.revisions[index - 1]?.revisionId) return false;
    if (index === 0 ? revision.source !== "genesis" || revision.actor.kind !== "system" : revision.source === "genesis") return false;
    if (TARGET_SOURCES.has(revision.source) !== (typeof revision.targetRevisionId === "string")) return false;
    if (revision.targetRevisionId && !ids.has(revision.targetRevisionId)) return false;
    const expected = await createRevision({ streamId: revision.streamId, ownerId: revision.ownerId, sequence: revision.sequence, ...(revision.parentRevisionId ? { parentRevisionId: revision.parentRevisionId } : {}), ...(revision.targetRevisionId ? { targetRevisionId: revision.targetRevisionId } : {}), snapshot: revision.snapshot, activation: revision.activation, actor: revision.actor, source: revision.source, committedAt: revision.committedAt, summary: revision.summary });
    if (expected.revisionId !== revision.revisionId || expected.snapshotDigest !== revision.snapshotDigest) return false;
    ids.add(revision.revisionId);
  }
  if (state.revisions.at(-1)?.revisionId !== state.headRevisionId) return false;
  if (state.checkpoint) {
    const boundary = state.revisions.find((revision) => revision.revisionId === state.checkpoint!.throughRevisionId);
    if (!hasExactKeys(state.checkpoint, ["integrityVersion", "throughRevisionId", "boundarySnapshot", "boundarySnapshotDigest", "retainedRevisionCount", "rangeStartedAt", "rangeEndedAt", "auditSummary", "retainedRoots", "createdAt", "digest"]) || !boundary
      || state.checkpoint.boundarySnapshot !== boundary.snapshot || state.checkpoint.boundarySnapshotDigest !== boundary.snapshotDigest
      || state.checkpoint.retainedRevisionCount !== state.revisions.length || Number.isNaN(Date.parse(state.checkpoint.createdAt)) || Number.isNaN(Date.parse(state.checkpoint.rangeStartedAt)) || Number.isNaN(Date.parse(state.checkpoint.rangeEndedAt))
      || !Array.isArray(state.checkpoint.retainedRoots) || state.checkpoint.retainedRoots.some((root) => typeof root !== "string") || !state.checkpoint.auditSummary || typeof state.checkpoint.auditSummary !== "object"
      || state.checkpoint.integrityVersion !== 1) return false;
    const { digest: _digest, integrityVersion: _version, ...checkpointFields } = state.checkpoint;
    if ((await createCheckpoint(checkpointFields, state.headRevisionId)).digest !== state.checkpoint.digest) return false;
  }
  return true;
}

async function migrateLegacyState(value: unknown, streamId: string, ownerId: string): Promise<AppearanceRevisionState | undefined> {
  if (!value || typeof value !== "object") return undefined;
  const legacy = value as { version?: unknown; headRevisionId?: unknown; revisions?: unknown };
  if (legacy.version !== 1 || typeof legacy.headRevisionId !== "string" || !Array.isArray(legacy.revisions) || legacy.revisions.length === 0) return undefined;
  const migrated: AppearanceRevision[] = [];
  const idMap = new Map<string, string>();
  for (let index = 0; index < legacy.revisions.length; index += 1) {
    const item = legacy.revisions[index] as Partial<AppearanceRevision>;
    if (typeof item.revisionId !== "string" || typeof item.snapshot !== "string" || typeof item.committedAt !== "string" || typeof item.summary !== "string"
      || item.sequence !== index || item.integrityVersion !== 1 || !item.actor || !ACTORS.has(item.actor.kind) || !SOURCES.has(item.source as AppearanceMutationSource)) return undefined;
    const oldSnapshotDigest = await digest(item.snapshot);
    const oldRevisionId = `myne-rev-v1-${await digest(JSON.stringify({ integrityVersion: 1, sequence: index, parentRevisionId: item.parentRevisionId ?? null, targetRevisionId: item.targetRevisionId ?? null, snapshotDigest: oldSnapshotDigest, actor: item.actor, source: item.source, committedAt: item.committedAt, summary: item.summary }))}`;
    if (oldRevisionId !== item.revisionId || item.snapshotDigest !== oldSnapshotDigest) return undefined;
    const activation = await activationForSnapshot(item.snapshot);
    if (!activation) return undefined;
    const parentRevisionId = index === 0 ? undefined : migrated[index - 1]?.revisionId;
    const targetRevisionId = item.targetRevisionId ? idMap.get(item.targetRevisionId) : undefined;
    if (item.targetRevisionId && !targetRevisionId) return undefined;
    const revision = await createRevision({ streamId, ownerId, sequence: index, ...(parentRevisionId ? { parentRevisionId } : {}), ...(targetRevisionId ? { targetRevisionId } : {}), snapshot: item.snapshot, activation, actor: item.actor, source: item.source as AppearanceMutationSource, committedAt: item.committedAt, summary: item.summary });
    migrated.push(revision); idMap.set(item.revisionId, revision.revisionId);
  }
  if (legacy.headRevisionId !== (legacy.revisions.at(-1) as { revisionId?: unknown } | undefined)?.revisionId) return undefined;
  return Object.freeze({ version: 1, streamId, ownerId, retention: Object.freeze({ mode: "retain-all", undoWindow: null, assetGc: "disabled" }), headRevisionId: migrated.at(-1)!.revisionId, revisions: Object.freeze(migrated) });
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

  static async open(options: { store: AppearanceRevisionStore; genesisSnapshot: string; streamId?: string; ownerId?: string; clock?: () => string; authorize?: (command: { actor: AppearanceActor; source: AppearanceMutationSource }) => boolean }): Promise<AppearanceRevisionService> {
    const loaded = await options.store.load();
    const clock = options.clock ?? (() => new Date().toISOString());
    const authorize = options.authorize ?? (() => true);
    const streamId = options.streamId ?? "myne.appearance.global";
    const ownerId = options.ownerId ?? "local-user";
    if (loaded !== undefined) {
      let validated: AppearanceRevisionState;
      if (await isState(loaded)) validated = loaded as AppearanceRevisionState;
      else {
        const migrated = await migrateLegacyState(loaded, streamId, ownerId);
        if (!migrated) throw new Error("corrupt-appearance-history");
        const oldHead = (loaded as { headRevisionId?: unknown }).headRevisionId;
        if (typeof oldHead !== "string" || await options.store.compareAndSwap(oldHead, migrated) === "stale") return AppearanceRevisionService.open(options);
        validated = migrated;
      }
      if (validated.revisions.some((revision) => !parseAppearanceSnapshot(revision.snapshot).ok)) throw new Error("corrupt-appearance-history");
      const state = Object.freeze({ ...validated, revisions: Object.freeze(validated.revisions.map(freezeRevision)) });
      return new AppearanceRevisionService(options.store, state, clock, authorize);
    }
    if (!parseAppearanceSnapshot(options.genesisSnapshot).ok) throw new Error("invalid-genesis-snapshot");
    const genesisActivation = await activationForSnapshot(options.genesisSnapshot);
    if (!genesisActivation) throw new Error("invalid-genesis-snapshot");
    const genesis = await createRevision({ streamId, ownerId, sequence: 0, snapshot: options.genesisSnapshot, activation: genesisActivation, actor: { id: "system", kind: "system" }, source: "genesis", committedAt: clock(), summary: "Initial appearance" });
    const state = Object.freeze({ version: 1 as const, streamId, ownerId, retention: Object.freeze({ mode: "retain-all" as const, undoWindow: null, assetGc: "disabled" as const }), headRevisionId: genesis.revisionId, revisions: Object.freeze([genesis]) });
    if (await options.store.compareAndSwap(undefined, state) === "stale") return AppearanceRevisionService.open(options);
    return new AppearanceRevisionService(options.store, state, clock, authorize);
  }

  inspect(): { readonly streamId: string; readonly ownerId: string; readonly retention: AppearanceRetentionPolicy; readonly head: AppearanceRevision | undefined; readonly revisions: readonly AppearanceRevision[]; readonly checkpoint?: AppearanceRevisionCheckpoint } {
    return Object.freeze({ streamId: this.#state.streamId, ownerId: this.#state.ownerId, retention: this.#state.retention, head: this.#state.revisions.at(-1), revisions: this.#state.revisions, ...(this.#state.checkpoint ? { checkpoint: this.#state.checkpoint } : {}) });
  }
  async inspectFresh(): Promise<ReturnType<AppearanceRevisionService["inspect"]>> {
    await this.#refreshFromStore();
    return this.inspect();
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
      return this.#appendNow(previous.snapshot, "undo", { ...command, targetRevisionId: target.revisionId, activation: previous.activation });
    });
  }
  checkpoint(options: { retainRecent: number }): Promise<void> {
    return this.#enqueue(async () => {
      await this.#refreshFromStore();
      const through = this.#state.revisions.at(Math.max(0, this.#state.revisions.length - Math.max(1, options.retainRecent) - 1));
      if (!through) return;
      const throughIndex = this.#state.revisions.indexOf(through);
      const covered = this.#state.revisions.slice(0, throughIndex + 1);
      const auditSummary = Object.freeze(Object.fromEntries([...SOURCES].map((source) => [source, covered.filter((revision) => revision.source === source).length])));
      const assetRoots = this.#state.revisions.flatMap((revision) => {
        const parsed = parseAppearanceSnapshot(revision.snapshot);
        return parsed.ok && parsed.value ? parsed.value.assets.map((asset) => asset.integrity) : [];
      });
      const retainedRoots = Object.freeze([...new Set([...this.#state.revisions.map((revision) => revision.revisionId), ...assetRoots])].sort());
      const checkpoint = await createCheckpoint({
        throughRevisionId: through.revisionId,
        boundarySnapshot: through.snapshot,
        boundarySnapshotDigest: through.snapshotDigest,
        retainedRevisionCount: this.#state.revisions.length,
        rangeStartedAt: covered[0]!.committedAt,
        rangeEndedAt: through.committedAt,
        auditSummary,
        retainedRoots,
        createdAt: this.clock(),
      }, this.#state.headRevisionId);
      const next = Object.freeze({ ...this.#state, checkpoint });
      const saved = await this.store.compareAndSwap(this.#state.headRevisionId, next);
      if (saved === "stale") throw new Error("stale-revision-during-compaction");
      this.#state = next;
    });
  }
  /** @deprecated v1 retains all history; this creates a verifiable checkpoint marker and does not compact. */
  compact(options: { retainRecent: number }): Promise<void> { return this.checkpoint(options); }
  #target(source: "restore" | "redo" | "revert", command: TargetCommand, parentSnapshot: boolean): Promise<AppearanceRevisionResult> {
    return this.#enqueue(async () => {
      const target = this.#find(command.targetRevisionId);
      if (!target || (parentSnapshot && !target.parentRevisionId)) return { ok: false, diagnostic: { code: "unknown-revision", message: "Target revision is unavailable." } };
      const selected = parentSnapshot ? this.#find(target.parentRevisionId!)! : target;
      return this.#appendNow(selected.snapshot, source, { ...command, activation: selected.activation });
    });
  }
  #append(snapshot: string, source: AppearanceMutationSource, command: MutationCommand & { targetRevisionId?: string }): Promise<AppearanceRevisionResult> { return this.#appendNow(snapshot, source, command); }
  async #appendNow(snapshot: string, source: AppearanceMutationSource, command: MutationCommand & { targetRevisionId?: string }): Promise<AppearanceRevisionResult> {
    if (!this.authorize({ actor: command.actor, source })) return { ok: false, diagnostic: { code: "unauthorized", message: "Actor is not authorized to mutate appearance." } };
    try { await this.#refreshFromStore(); }
    catch { return { ok: false, diagnostic: { code: "persistence-failed", message: "Appearance history could not be refreshed safely." } }; }
    if (command.expectedCurrentRevisionId !== this.#state.headRevisionId) return { ok: false, diagnostic: { code: "stale-revision", message: "Appearance head changed; refresh and review the diff before retrying.", expectedRevisionId: command.expectedCurrentRevisionId, currentRevisionId: this.#state.headRevisionId } };
    if (!parseAppearanceSnapshot(snapshot).ok) return { ok: false, diagnostic: { code: "invalid-snapshot", message: "Mutation snapshot is invalid or non-canonical." } };
    const summary = command.summary.trim().slice(0, 240);
    const parsedSnapshot = parseAppearanceSnapshot(snapshot);
    if (!parsedSnapshot.ok || !parsedSnapshot.value) return { ok: false, diagnostic: { code: "invalid-snapshot", message: "Mutation snapshot is invalid or non-canonical." } };
    const expectedSourceDigest = await sourceDigestForAppearanceSnapshot(parsedSnapshot.value);
    const activation = command.activation ?? await activationForSnapshot(snapshot);
    if (!activation) return { ok: false, diagnostic: { code: "invalid-snapshot", message: "Appearance activation artifact could not be reproduced." } };
    if (activation.sourceDigest !== expectedSourceDigest) return { ok: false, diagnostic: { code: "invalid-snapshot", message: "Appearance activation source digest does not match the canonical snapshot." } };
    const revision = await createRevision({ streamId: this.#state.streamId, ownerId: this.#state.ownerId, sequence: this.#state.revisions.length, parentRevisionId: this.#state.headRevisionId, ...(command.targetRevisionId ? { targetRevisionId: command.targetRevisionId } : {}), snapshot, activation, actor: command.actor, source, committedAt: this.clock(), summary });
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
  async #refreshFromStore(): Promise<void> {
    const latest = await this.store.load();
    if (latest === undefined || !await isState(latest) || (latest as AppearanceRevisionState).revisions.some((item) => !parseAppearanceSnapshot(item.snapshot).ok)) {
      throw new Error("corrupt-appearance-history");
    }
    const validated = latest as AppearanceRevisionState;
    this.#state = Object.freeze({ ...validated, revisions: Object.freeze(validated.revisions.map(freezeRevision)) });
  }
  #enqueue<T>(operation: () => Promise<T>): Promise<T> { const result = this.#queue.then(operation, operation); this.#queue = result.then(() => undefined, () => undefined); return result; }
}

async function activationForSnapshot(snapshot: string): Promise<AppearanceActivationRecord | undefined> {
  const parsed = parseAppearanceSnapshot(snapshot);
  if (!parsed.ok || !parsed.value) return undefined;
  const activeSkin = parsed.value.skin.userSkins.find((skin) => skin.id === parsed.value!.skin.activeGlobalSkinId);
  if (activeSkin?.rawCss.length) return undefined;
  return Object.freeze({
    sourceDigest: await sourceDigestForAppearanceSnapshot(parsed.value),
    artifactDigest: null,
    compilerVersion: 1,
    policyVersion: 1,
  });
}
