import type { PreviewProcessLink } from './vk-client';

type RetainedLink = { link: PreviewProcessLink; expiresAt: number };
type StoppedProcess = {
  workspaceId: string;
  processId: string;
  previewSlotId?: string;
  timestamp: string;
  expiresAt: number;
};

export class PreviewProcessLinkStore {
  private readonly links = new Map<string, RetainedLink>();
  private readonly stopped = new Map<string, StoppedProcess>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 1_000;
  }

  remember(workspaceId: string, link: PreviewProcessLink): void {
    if (link.workspace_id !== workspaceId || !link.execution_process_id) return;
    this.prune();
    this.links.delete(link.execution_process_id);
    while (this.links.size >= this.maxEntries) {
      const oldest = this.links.keys().next().value as string | undefined;
      if (!oldest) break;
      this.links.delete(oldest);
    }
    this.links.set(link.execution_process_id, { link: { ...link }, expiresAt: this.now() + this.ttlMs });
  }

  has(workspaceId: string, processId: string): boolean {
    this.prune();
    return this.links.get(processId)?.link.workspace_id === workspaceId;
  }

  markStopped(workspaceId: string, processId: string, previewSlotId?: string): void {
    this.prune();
    const timestamp = new Date(this.now()).toISOString();
    this.stopped.set(processId, {
      workspaceId,
      processId,
      previewSlotId,
      timestamp,
      expiresAt: this.now() + this.ttlMs,
    });
    const retained = this.links.get(processId);
    if (!retained || retained.link.workspace_id !== workspaceId) return;
    retained.link = {
      ...retained.link,
      status_snapshot: 'stopped',
      ended_at: timestamp,
      updated_at: timestamp,
    };
  }

  merge(workspaceId: string, authoritative: PreviewProcessLink[]): PreviewProcessLink[] {
    this.prune();
    const overlaidAuthoritative = authoritative.map((item) => this.withStoppedOverlay(workspaceId, item));
    const authoritativeRuns = new Set(overlaidAuthoritative.map((item) => item.run_config_id));
    const authoritativeSlots = new Set(overlaidAuthoritative.flatMap((item) => item.preview_slot_id ? [item.preview_slot_id] : []));
    const retained = [...this.links.values()].reverse().map(({ link }) => link).filter((item) =>
      item.workspace_id === workspaceId &&
      (item.preview_slot_id
        ? !authoritativeSlots.has(item.preview_slot_id)
        : !authoritativeRuns.has(item.run_config_id)),
    );
    return [...overlaidAuthoritative, ...retained];
  }

  private prune(): void {
    const now = this.now();
    for (const [processId, retained] of this.links) {
      if (retained.expiresAt <= now) this.links.delete(processId);
    }
    for (const [processId, stopped] of this.stopped) {
      if (stopped.expiresAt <= now) this.stopped.delete(processId);
    }
  }

  private withStoppedOverlay(workspaceId: string, link: PreviewProcessLink): PreviewProcessLink {
    const stopped = this.stopped.get(link.execution_process_id);
    if (!stopped || stopped.workspaceId !== workspaceId) return link;
    if (stopped.previewSlotId && stopped.previewSlotId !== link.preview_slot_id) return link;
    return {
      ...link,
      status_snapshot: 'stopped',
      ended_at: link.ended_at ?? stopped.timestamp,
      updated_at: stopped.timestamp,
    };
  }
}
