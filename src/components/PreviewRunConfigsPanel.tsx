import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PreviewSlot,
  RunConfig,
  RunConfigKind,
  WorkspaceRunConfigsResponse,
} from '../server/vk-client';

type RepoOption = { id: string; label: string };

export function PreviewRunConfigsPanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [data, setData] = useState<WorkspaceRunConfigsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runForm, setRunForm] = useState({
    repoId: '',
    slug: 'web',
    name: 'Web',
    command: 'npm run dev',
    kind: 'long_running' as RunConfigKind,
  });
  const [slotForm, setSlotForm] = useState({
    repoId: '',
    runConfigId: '',
    slotSlug: 'web',
    title: 'Web',
  });

  const refresh = useCallback(async () => {
    setError(null);
    const response = await fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`);
    if (!response.ok) throw new Error(await response.text());
    const next = await response.json() as WorkspaceRunConfigsResponse;
    setData(next);
  }, [workspaceId]);

  useEffect(() => {
    void refresh().catch((err) => setError(errorMessage(err)));
  }, [refresh]);

  useEffect(() => {
    const firstRunConfig = data?.run_configs[0];
    const firstSlot = data?.preview_slots[0];
    setRunForm((current) => ({
      ...current,
      repoId: current.repoId || firstRunConfig?.repo_id || firstSlot?.repo_id || '',
    }));
    setSlotForm((current) => ({
      ...current,
      repoId: current.repoId || firstSlot?.repo_id || firstRunConfig?.repo_id || '',
      runConfigId: current.runConfigId || firstSlot?.run_config_id || firstRunConfig?.id || '',
    }));
  }, [data]);

  const repos = useMemo<RepoOption[]>(() => {
    const labels = new Map<string, string>();
    for (const runConfig of data?.run_configs ?? []) labels.set(runConfig.repo_id, runConfig.repo_id);
    for (const slot of data?.preview_slots ?? []) labels.set(slot.repo_id, slot.repo_id);
    return Array.from(labels, ([id, label]) => ({ id, label }));
  }, [data]);

  async function upsertRunConfig() {
    setMessage(null);
    setError(null);
    const response = await fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo_id: runForm.repoId,
        slug: runForm.slug,
        name: runForm.name,
        command: runForm.command,
        kind: runForm.kind,
        enabled: true,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const created = await response.json() as RunConfig;
    setMessage(`Saved run config ${created.slug}`);
    setSlotForm((current) => ({
      ...current,
      repoId: created.repo_id,
      runConfigId: created.id,
      slotSlug: current.slotSlug || created.slug.slice(0, 10),
      title: current.title || created.name,
    }));
    await refresh();
  }

  async function upsertPreviewSlot() {
    setMessage(null);
    setError(null);
    const response = await fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo_id: slotForm.repoId,
        run_config_id: slotForm.runConfigId,
        slot_slug: slotForm.slotSlug,
        title: slotForm.title,
        enabled: true,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const created = await response.json() as PreviewSlot;
    setMessage(`Saved preview slot ${created.slot_slug}`);
    await refresh();
  }

  async function startRunConfig(runConfigId: string) {
    await action(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs/${encodeURIComponent(runConfigId)}/start`, 'Started run config');
  }

  async function startPreviewSlot(previewSlotId: string) {
    await action(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(previewSlotId)}/start`, 'Started preview slot');
  }

  async function action(url: string, successMessage: string, method = 'POST') {
    setMessage(null);
    setError(null);
    const response = await fetch(url, { method });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.message || 'Preview action failed');
    }
    setMessage(successMessage);
    await refresh();
  }

  async function deletePreviewSlot(slotId: string) {
    await action(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(slotId)}`, 'Deleted preview slot', 'DELETE');
  }

  async function deleteRunConfig(configId: string) {
    await action(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs/${encodeURIComponent(configId)}`, 'Deleted run config', 'DELETE');
  }

  const runConfigs = data?.run_configs ?? [];
  const previewSlots = data?.preview_slots ?? [];

  return (
    <div className="h-full overflow-auto bg-background text-foreground p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">PreviewServer</h1>
          <p className="text-sm text-default-500">
            Minimal V1 controls for stored run configs, preview slots, and canonical Preview URLs.
          </p>
        </header>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {message ? <Notice tone="info">{message}</Notice> : null}

        <section className="rounded-lg border border-divider/30 bg-content1/70 p-4">
          <h2 className="font-medium">Create stored run config</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput label="Repo ID" value={runForm.repoId} onChange={(repoId) => setRunForm((current) => ({ ...current, repoId }))} />
            <TextInput label="Slug" value={runForm.slug} onChange={(slug) => setRunForm((current) => ({ ...current, slug }))} />
            <TextInput label="Name" value={runForm.name} onChange={(name) => setRunForm((current) => ({ ...current, name }))} />
            <label className="text-sm">
              <span className="block text-foreground">Kind</span>
              <select
                className="mt-1 w-full rounded border border-divider/30 bg-background p-2 text-foreground"
                value={runForm.kind}
                onChange={(event) => setRunForm((current) => ({ ...current, kind: event.target.value as RunConfigKind }))}
              >
                <option value="long_running">Long running</option>
                <option value="one_shot">One-shot</option>
                <option value="test">Test</option>
              </select>
            </label>
          </div>
          <TextArea label="Command" value={runForm.command} onChange={(command) => setRunForm((current) => ({ ...current, command }))} />
          <button className="mt-3 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80" onClick={() => void upsertRunConfig().catch((err) => setError(errorMessage(err)))}>
            Save run config
          </button>
        </section>

        <section className="rounded-lg border border-divider/30 bg-content1/70 p-4">
          <h2 className="font-medium">Create preview slot</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput label="Repo ID" value={slotForm.repoId} onChange={(repoId) => setSlotForm((current) => ({ ...current, repoId }))} />
            <SelectInput label="Run config" value={slotForm.runConfigId} options={runConfigs.map((item) => ({ id: item.id, label: `${item.name} (${item.slug})` }))} onChange={(runConfigId) => setSlotForm((current) => ({ ...current, runConfigId }))} />
            <TextInput label="Slot slug" value={slotForm.slotSlug} onChange={(slotSlug) => setSlotForm((current) => ({ ...current, slotSlug }))} />
            <TextInput label="Title" value={slotForm.title} onChange={(title) => setSlotForm((current) => ({ ...current, title }))} />
          </div>
          <button className="mt-3 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80" onClick={() => void upsertPreviewSlot().catch((err) => setError(errorMessage(err)))}>
            Save preview slot
          </button>
        </section>

        <section className="rounded-lg border border-divider/30 bg-content1/70 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-medium">Preview slots</h2>
              <p className="text-sm text-default-500">Generate a named Preview URL or start the stored config.</p>
            </div>
          </div>
          <ListEmpty items={previewSlots} label="No preview slots yet." />
          <div className="mt-3 space-y-2">
            {previewSlots.map((slot) => (
              <div key={slot.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-divider/30 p-3">
                <div>
                  <div className="font-medium">{slot.title} <span className="text-default-500">/{slot.slot_slug}</span></div>
                  <div className="text-xs text-default-500">repo {slot.repo_id} · run config {slot.run_config_id}</div>
                </div>
                <div className="flex gap-2">
                  <button className="rounded border border-divider/30 px-3 py-1 text-sm" onClick={() => void startPreviewSlot(slot.id).catch((err) => setError(errorMessage(err)))}>Start</button>
                  <a className="rounded border border-divider/30 px-3 py-1 text-sm" href={data?.preview_urls?.[slot.id]} target="_blank" rel="noopener noreferrer">Open URL</a>
                  <button className="rounded border border-danger/40 px-3 py-1 text-sm text-danger" aria-label={`Delete preview slot ${slot.title}`} onClick={() => void deletePreviewSlot(slot.id).catch((err) => setError(errorMessage(err)))}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-divider/30 bg-content1/70 p-4">
          <h2 className="font-medium">Run configs</h2>
          <ListEmpty items={runConfigs} label="No run configs yet." />
          <div className="mt-3 space-y-2">
            {runConfigs.map((runConfig) => (
              <div key={runConfig.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-divider/30 p-3">
                <div>
                  <div className="font-medium">{runConfig.name} <span className="text-default-500">/{runConfig.slug}</span></div>
                  <code className="text-xs text-default-500">{runConfig.command}</code>
                </div>
                <div className="flex gap-2">
                <button className="rounded border border-divider/30 px-3 py-1 text-sm" onClick={() => void startRunConfig(runConfig.id).catch((err) => setError(errorMessage(err)))}>
                  Run on demand
                </button>
                <button className="rounded border border-danger/40 px-3 py-1 text-sm text-danger" aria-label={`Delete run config ${runConfig.name}`} onClick={() => void deleteRunConfig(runConfig.id).catch((err) => setError(errorMessage(err)))}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {repos.length === 0 ? (
          <p className="text-xs text-default-500">
            Tip: repo IDs appear after at least one run config or preview slot exists. Agents can also call the HTTP API directly.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="block text-foreground">{label}</span>
      <input className="mt-1 w-full rounded border border-divider/30 bg-background p-2 text-foreground" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: RepoOption[]; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="block text-foreground">{label}</span>
      <select className="mt-1 w-full rounded border border-divider/30 bg-background p-2 text-foreground" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select…</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-sm">
      <span className="block text-foreground">{label}</span>
      <textarea className="mt-1 min-h-20 w-full rounded border border-divider/30 bg-background p-2 font-mono text-foreground" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <div className={tone === 'error' ? 'rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger' : 'rounded border border-primary/40 bg-primary/10 p-3 text-sm text-primary'}>
      {children}
    </div>
  );
}

function ListEmpty<T>({ items, label }: { items: T[]; label: string }) {
  return items.length === 0 ? <p className="mt-3 text-sm text-default-500">{label}</p> : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
