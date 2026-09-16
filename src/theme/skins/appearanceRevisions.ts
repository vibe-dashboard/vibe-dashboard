import { parseAppearanceSnapshot } from "./appearanceSnapshot";

export type AppearanceMutationSource = "genesis" | "user" | "agent" | "cli" | "import" | "marketplace" | "undo" | "redo" | "revert" | "restore";
export interface AppearanceActor { readonly id: string; readonly kind: "system" | "user" | "agent" | "cli" | "import" | "marketplace" }
export interface AppearanceRevision {
  readonly revisionId: string; readonly parentRevisionId?: string; readonly targetRevisionId?: string;
  readonly snapshot: string; readonly actor: AppearanceActor; readonly source: AppearanceMutationSource;
  readonly committedAt: string; readonly summary: string;
}
export interface AppearanceRevisionCheckpoint { readonly throughRevisionId: string; readonly retainedRevisionCount: number; readonly createdAt: string }
export interface AppearanceRevisionState { readonly version: 1; readonly headRevisionId: string; readonly revisions: readonly AppearanceRevision[]; readonly checkpoint?: AppearanceRevisionCheckpoint }
export interface AppearanceRevisionStore { load(): Promise<unknown | undefined>; compareAndSwap(expectedHeadRevisionId: string | undefined, state: AppearanceRevisionState): Promise<"saved" | "stale"> }
export interface AppearanceRevisionDiagnostic { readonly code: "stale-revision" | "persistence-failed" | "unauthorized" | "invalid-snapshot" | "unknown-revision" | "nothing-to-undo"; readonly message: string; readonly expectedRevisionId?: string; readonly currentRevisionId?: string }
export type AppearanceRevisionResult = { readonly ok: true; readonly revision: AppearanceRevision } | { readonly ok: false; readonly diagnostic: AppearanceRevisionDiagnostic };

interface MutationCommand { expectedCurrentRevisionId: string; actor: AppearanceActor; summary: string }
interface ApplyCommand extends MutationCommand { snapshot: string; source: Exclude<AppearanceMutationSource, "genesis" | "undo" | "redo" | "revert" | "restore"> }
interface TargetCommand extends MutationCommand { targetRevisionId: string }

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function freezeRevision(revision: AppearanceRevision): AppearanceRevision { return Object.freeze({ ...revision, actor: Object.freeze({ ...revision.actor }) }); }
async function revisionId(parent: string | undefined, snapshot: string, source: string, sequence: number): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${parent ?? "genesis"}\n${source}\n${sequence}\n${snapshot}`)));
  return `myne-rev-${[...bytes.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function isState(value: unknown): value is AppearanceRevisionState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AppearanceRevisionState>;
  if (!(state.version === 1 && typeof state.headRevisionId === "string" && Array.isArray(state.revisions) && state.revisions.length > 0)) return false;
  const ids = new Set<string>();
  for (let index = 0; index < state.revisions.length; index += 1) {
    const revision = state.revisions[index];
    if (!revision || typeof revision.revisionId !== "string" || ids.has(revision.revisionId) || typeof revision.snapshot !== "string"
      || typeof revision.committedAt !== "string" || Number.isNaN(Date.parse(revision.committedAt)) || typeof revision.summary !== "string"
      || !revision.actor || typeof revision.actor.id !== "string" || typeof revision.source !== "string") return false;
    if (index === 0 ? revision.parentRevisionId !== undefined : revision.parentRevisionId !== state.revisions[index - 1]?.revisionId) return false;
    ids.add(revision.revisionId);
  }
  return state.revisions.at(-1)?.revisionId === state.headRevisionId;
}

export class MemoryAppearanceRevisionStore implements AppearanceRevisionStore {
  #state: unknown;
  #fail = false;
  async load(): Promise<unknown | undefined> { return this.#state === undefined ? undefined : clone(this.#state); }
  async compareAndSwap(expectedHeadRevisionId: string | undefined, state: AppearanceRevisionState): Promise<"saved" | "stale"> {
    if (this.#fail) { this.#fail = false; throw new Error("injected persistence failure"); }
    const currentHead = isState(this.#state) ? this.#state.headRevisionId : undefined;
    if (currentHead !== expectedHeadRevisionId) return "stale";
    this.#state = clone(state); return "saved";
  }
  failNextWrite(): void { this.#fail = true; }
  corrupt(): void { this.#state = { version: 1, headRevisionId: "missing", revisions: [] }; }
}

export class AppearanceRevisionService {
  #state: AppearanceRevisionState;
  #queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private readonly store: AppearanceRevisionStore,
    state: AppearanceRevisionState,
    private readonly clock: () => string,
    private readonly authorize: (command: { actor: AppearanceActor; source: AppearanceMutationSource }) => boolean,
  ) { this.#state = state; }

  static async open(options: { store: AppearanceRevisionStore; genesisSnapshot: string; clock?: () => string; authorize?: (command: { actor: AppearanceActor; source: AppearanceMutationSource }) => boolean }): Promise<AppearanceRevisionService> {
    const loaded = await options.store.load();
    const clock = options.clock ?? (() => new Date().toISOString());
    const authorize = options.authorize ?? (() => true);
    if (loaded !== undefined) {
      if (!isState(loaded) || loaded.revisions.some((revision) => !parseAppearanceSnapshot(revision.snapshot).ok)) throw new Error("corrupt-appearance-history");
      const state = Object.freeze({ ...loaded, revisions: Object.freeze(loaded.revisions.map(freezeRevision)) });
      return new AppearanceRevisionService(options.store, state, clock, authorize);
    }
    if (!parseAppearanceSnapshot(options.genesisSnapshot).ok) throw new Error("invalid-genesis-snapshot");
    const genesis = freezeRevision({ revisionId: await revisionId(undefined, options.genesisSnapshot, "genesis", 0), snapshot: options.genesisSnapshot, actor: { id: "system", kind: "system" }, source: "genesis", committedAt: clock(), summary: "Initial appearance" });
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
      const next = Object.freeze({ ...this.#state, checkpoint: Object.freeze({ throughRevisionId: through.revisionId, retainedRevisionCount: this.#state.revisions.length, createdAt: this.clock() }) });
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
    const revision = freezeRevision({ revisionId: await revisionId(this.#state.headRevisionId, snapshot, source, this.#state.revisions.length), parentRevisionId: this.#state.headRevisionId, ...(command.targetRevisionId ? { targetRevisionId: command.targetRevisionId } : {}), snapshot, actor: command.actor, source, committedAt: this.clock(), summary });
    const next = Object.freeze({ ...this.#state, headRevisionId: revision.revisionId, revisions: Object.freeze([...this.#state.revisions, revision]) });
    try {
      if (await this.store.compareAndSwap(command.expectedCurrentRevisionId, next) === "stale") {
        const latest = await this.store.load();
        const currentRevisionId = isState(latest) ? latest.headRevisionId : this.#state.headRevisionId;
        return { ok: false, diagnostic: { code: "stale-revision", message: "Appearance head changed; refresh and review the diff before retrying.", expectedRevisionId: command.expectedCurrentRevisionId, currentRevisionId } };
      }
    } catch { return { ok: false, diagnostic: { code: "persistence-failed", message: "Appearance history was not changed because persistence failed." } }; }
    this.#state = next; return { ok: true, revision };
  }
  #find(id: string): AppearanceRevision | undefined { return this.#state.revisions.find((revision) => revision.revisionId === id); }
  #enqueue<T>(operation: () => Promise<T>): Promise<T> { const result = this.#queue.then(operation, operation); this.#queue = result.then(() => undefined, () => undefined); return result; }
}
