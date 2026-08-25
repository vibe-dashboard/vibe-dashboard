import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PreviewSlot,
  PreviewProcessLink,
  RawLogEntry,
  RepoWithBranch,
  RunConfig,
  RunConfigKind,
  RunConfigStartResponse,
  WorkspaceRunConfigsResponse,
} from '../server/vk-client';

type RepoOption = { id: string; label: string };
type LogPanelState =
  | { status: 'no-process' }
  | { status: 'loading'; processId: string }
  | { status: 'loaded'; processId: string; logs: RawLogEntry[] }
  | { status: 'error'; processId: string; message: string };
type SlotActionState = 'stopping' | 'restarting';

export function PreviewRunConfigsPanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [data, setData] = useState<WorkspaceRunConfigsResponse | null>(null);
  const [workspaceRepos, setWorkspaceRepos] = useState<RepoWithBranch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runConfigProcessIds, setRunConfigProcessIds] = useState<Record<string, string>>({});
  const [previewSlotProcessIds, setPreviewSlotProcessIds] = useState<Record<string, string>>({});
  const [previewSlotProcessLinks, setPreviewSlotProcessLinks] = useState<Record<string, PreviewProcessLink>>({});
  const stoppedPreviewSlotProcessesRef = useRef<Record<string, string>>({});
  const [, setStoppedPreviewSlotProcesses] = useState<Record<string, string>>({});
  const [previewSlotActions, setPreviewSlotActions] = useState<Record<string, SlotActionState>>({});
  const [logPanels, setLogPanels] = useState<Record<string, LogPanelState>>({});
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [runForm, setRunForm] = useState({
    slug: 'web',
    name: 'Web',
    description: '',
    command: 'npm run dev',
    kind: 'long_running' as RunConfigKind,
  });
  const [slotForm, setSlotForm] = useState({
    runConfigId: '',
    slotSlug: 'web',
    title: 'Web',
    description: '',
  });

  function setStoppedPreviewSlotProcess(slotId: string, processId: string) {
    const next = { ...stoppedPreviewSlotProcessesRef.current, [slotId]: processId };
    stoppedPreviewSlotProcessesRef.current = next;
    setStoppedPreviewSlotProcesses(next);
  }

  function clearStoppedPreviewSlotProcess(slotId: string) {
    const next = clearRecordKey(stoppedPreviewSlotProcessesRef.current, slotId);
    stoppedPreviewSlotProcessesRef.current = next;
    setStoppedPreviewSlotProcesses(next);
  }

  const refresh = useCallback(async () => {
    setError(null);
    const [runConfigsResponse, reposResponse] = await Promise.all([
      fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`),
      fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/repos`),
    ]);
    if (!runConfigsResponse.ok) throw new Error(await runConfigsResponse.text());
    if (!reposResponse.ok) throw new Error(await reposResponse.text());
    const next = await runConfigsResponse.json() as WorkspaceRunConfigsResponse;
    const nextRepos = await reposResponse.json() as RepoWithBranch[];
    setData(next);
    setWorkspaceRepos(nextRepos);
    if (next.preview_process_links) {
      const nextRunProcesses: Record<string, string> = {};
      const nextSlotProcesses: Record<string, string> = {};
      const nextSlotLinks: Record<string, PreviewProcessLink> = {};
      for (const link of next.preview_process_links) {
        // VK returns links newest-first, so retain the newest linked slot process
        // when multiple slots share one run config.
        nextRunProcesses[link.run_config_id] ??= link.execution_process_id;
        if (link.preview_slot_id) {
          nextSlotProcesses[link.preview_slot_id] ??= link.execution_process_id;
          const stoppedProcessId = stoppedPreviewSlotProcessesRef.current[link.preview_slot_id];
          nextSlotLinks[link.preview_slot_id] ??= stoppedProcessId === link.execution_process_id
            ? markLinkStopped(link, link.execution_process_id)
            : link;
        }
      }
      // A supporting VK response is authoritative. Replacing rather than
      // merging prevents removed links from leaving stale Logs actions, while
      // an older VK that omits this field keeps panel-started process IDs.
      setRunConfigProcessIds((current) => ({ ...current, ...nextRunProcesses }));
      setPreviewSlotProcessIds((current) => ({ ...current, ...nextSlotProcesses }));
      setPreviewSlotProcessLinks((current) => ({ ...current, ...nextSlotLinks }));
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh().catch((err) => setError(errorMessage(err)));
  }, [refresh]);

  useEffect(() => {
    if (!workspaceRepos.length) {
      setSelectedRepoId('');
      return;
    }
    setSelectedRepoId((current) =>
      current && workspaceRepos.some((repo) => repo.id === current)
        ? current
        : workspaceRepos[0]!.id,
    );
  }, [workspaceRepos]);

  useEffect(() => {
    const repoRunConfigs = selectedRepoId
      ? (data?.run_configs ?? []).filter((runConfig) => runConfig.repo_id === selectedRepoId)
      : [];
    const firstRunConfig = repoRunConfigs[0];
    setSlotForm((current) => ({
      ...current,
      runConfigId:
        current.runConfigId && repoRunConfigs.some((runConfig) => runConfig.id === current.runConfigId)
          ? current.runConfigId
          : firstRunConfig?.id || '',
    }));
  }, [data, selectedRepoId]);

  const repoOptions = useMemo<RepoOption[]>(
    () => workspaceRepos.map((repo) => ({ id: repo.id, label: formatRepoLabel(repo) })),
    [workspaceRepos],
  );
  const runConfigs = data?.run_configs ?? [];
  const previewSlots = data?.preview_slots ?? [];
  const repoLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const repo of workspaceRepos) labels.set(repo.id, formatRepoLabel(repo));
    return labels;
  }, [workspaceRepos]);
  const runConfigLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const runConfig of runConfigs) labels.set(runConfig.id, formatRunConfigLabel(runConfig));
    return labels;
  }, [runConfigs]);
  const selectedRepo = workspaceRepos.find((repo) => repo.id === selectedRepoId);
  const selectedRepoRunConfigs = useMemo(
    () => runConfigs.filter((runConfig) => runConfig.repo_id === selectedRepoId),
    [runConfigs, selectedRepoId],
  );
  const matchingRunConfig = useMemo(
    () => selectedRepoRunConfigs.find((runConfig) => runConfig.slug === runForm.slug.trim()),
    [runForm.slug, selectedRepoRunConfigs],
  );
  const hasSelectedRepo = Boolean(selectedRepoId);
  const deepLinkedSlotId = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('previewSlotId');
  const deepLinkedWorkspaceId = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('previewWorkspaceId');

  async function upsertRunConfig() {
    if (!selectedRepoId) {
      setError('Select a repository before saving a run config.');
      return;
    }
    setMessage(null);
    setError(null);
    const slug = runForm.slug.trim();
    const response = await fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: matchingRunConfig?.id,
        repo_id: selectedRepoId,
        slug,
        name: runForm.name,
        description: runForm.description.trim() || null,
        command: runForm.command,
        kind: runForm.kind,
        enabled: true,
      }),
    });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Preview run config save failed'));
    const created = await response.json() as RunConfig;
    setMessage(`${matchingRunConfig ? 'Updated' : 'Saved'} run config ${created.slug}`);
    setSlotForm((current) => ({
      ...current,
      runConfigId: created.id,
      slotSlug: current.slotSlug || created.slug.slice(0, 10),
      title: current.title || created.name,
    }));
    await refresh();
  }

  async function upsertPreviewSlot() {
    if (!selectedRepoId) {
      setError('Select a repository before saving a preview slot.');
      return;
    }
    setMessage(null);
    setError(null);
    const response = await fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo_id: selectedRepoId,
        run_config_id: slotForm.runConfigId,
        slot_slug: slotForm.slotSlug,
        title: slotForm.title,
        description: slotForm.description.trim() || null,
        enabled: true,
      }),
    });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Preview slot save failed'));
    const created = await response.json() as PreviewSlot;
    setMessage(`Saved preview slot ${created.slot_slug}`);
    await refresh();
  }

  async function deleteRunConfig(runConfig: RunConfig) {
    if (!confirm(`Delete run config "${runConfig.name || runConfig.slug}"? This cannot be undone.`)) return;
    setMessage(null);
    setError(null);
    const response = await fetch(
      `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs/${encodeURIComponent(runConfig.id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Preview run config delete failed'));
    setRunConfigProcessIds((current) => {
      const next = { ...current };
      delete next[runConfig.id];
      return next;
    });
    setLogPanels((current) => {
      const next = { ...current };
      delete next[`run:${runConfig.id}`];
      return next;
    });
    setMessage(`Deleted run config ${runConfig.name || runConfig.slug}`);
    await refresh();
  }

  async function deletePreviewSlot(slot: PreviewSlot) {
    if (!confirm(`Delete preview slot "${slot.title || slot.slot_slug}"? This cannot be undone.`)) return;
    setMessage(null);
    setError(null);
    const response = await fetch(
      `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(slot.id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Preview slot delete failed'));
    setPreviewSlotProcessIds((current) => {
      const next = { ...current };
      delete next[slot.id];
      return next;
    });
    setPreviewSlotProcessLinks((current) => {
      const next = { ...current };
      delete next[slot.id];
      return next;
    });
    clearStoppedPreviewSlotProcess(slot.id);
    setLogPanels((current) => {
      const next = { ...current };
      delete next[`slot:${slot.id}`];
      return next;
    });
    setMessage(`Deleted preview slot ${slot.title || slot.slot_slug}`);
    await refresh();
  }

  async function startRunConfig(runConfigId: string) {
    const result = await postAction<RunConfigStartResponse>(
      `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs/${encodeURIComponent(runConfigId)}/start`,
    );
    setRunConfigProcessIds((current) => ({
      ...current,
      [runConfigId]: result.execution_process.id,
    }));
    setMessage(`Started run config process ${result.execution_process.id}`);
    await refresh();
  }

  async function startPreviewSlot(previewSlotId: string) {
    const result = await postAction<RunConfigStartResponse>(
      `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(previewSlotId)}/start`,
    );
    setPreviewSlotProcessIds((current) => ({
      ...current,
      [previewSlotId]: result.execution_process.id,
    }));
    setPreviewSlotProcessLinks((current) => ({
      ...current,
      [previewSlotId]: result.preview_process_link,
    }));
    clearStoppedPreviewSlotProcess(previewSlotId);
    setMessage(`Started preview slot process ${result.execution_process.id}`);
    await refresh();
  }

  async function stopPreviewSlot(slot: PreviewSlot) {
    const link = previewSlotProcessLinks[slot.id];
    const processId = link?.execution_process_id ?? previewSlotProcessIds[slot.id];
    if (!processId) {
      setMessage('No linked preview slot process to stop.');
      setLogPanels((current) => ({ ...current, [`slot:${slot.id}`]: { status: 'no-process' } }));
      return;
    }
    if (link && !isRunningPreviewLink(link)) {
      setMessage('No running preview slot process to stop. Logs remain available on demand.');
      return;
    }
    if (!confirm(`Stop preview slot "${slot.title || slot.slot_slug}"? Logs will remain available on demand.`)) return;
    setPreviewSlotActions((current) => ({ ...current, [slot.id]: 'stopping' }));
    try {
      await stopPreviewProcess(processId, slot.id);
      setStoppedPreviewSlotProcess(slot.id, processId);
      setPreviewSlotProcessLinks((current) => ({
        ...current,
        [slot.id]: markLinkStopped(current[slot.id], processId),
      }));
      setMessage('Stopped preview slot process. Logs remain available on demand.');
      await refresh();
    } finally {
      setPreviewSlotActions((current) => clearRecordKey(current, slot.id));
    }
  }

  async function restartPreviewSlot(slot: PreviewSlot) {
    const link = previewSlotProcessLinks[slot.id];
    const processId = link?.execution_process_id ?? previewSlotProcessIds[slot.id];
    if (link && isRunningPreviewLink(link)) {
      if (!confirm(`Restart preview slot "${slot.title || slot.slot_slug}"? The current process will be stopped first.`)) return;
    }
    setPreviewSlotActions((current) => ({ ...current, [slot.id]: 'restarting' }));
    setMessage(null);
    setError(null);
    try {
      if (processId && (!link || isRunningPreviewLink(link))) {
        await stopPreviewProcess(processId, slot.id);
        setStoppedPreviewSlotProcess(slot.id, processId);
        setPreviewSlotProcessLinks((current) => ({
          ...current,
          [slot.id]: markLinkStopped(current[slot.id], processId),
        }));
      }
      const response = await fetch(
        `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(slot.id)}/start`,
        { method: 'POST' },
      );
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, 'Preview slot restart failed'));
      }
      const result = await response.json() as RunConfigStartResponse;
      setPreviewSlotProcessIds((current) => ({
        ...current,
        [slot.id]: result.execution_process.id,
      }));
      setPreviewSlotProcessLinks((current) => ({
        ...current,
        [slot.id]: result.preview_process_link,
      }));
      clearStoppedPreviewSlotProcess(slot.id);
      setMessage('Restarted preview slot process.');
      await refresh();
    } finally {
      setPreviewSlotActions((current) => clearRecordKey(current, slot.id));
    }
  }

  async function stopPreviewProcess(processId: string, previewSlotId?: string) {
    setMessage(null);
    setError(null);
    const response = await fetch(
      `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/execution-processes/${encodeURIComponent(processId)}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ previewSlotId: previewSlotId ?? null }),
      },
    );
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Preview process stop failed'));
  }

  async function postAction<T>(url: string): Promise<T> {
    setMessage(null);
    setError(null);
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Preview action failed'));
    return await response.json() as T;
  }

  async function showLogs(logKey: string, processId: string | undefined) {
    if (!processId) {
      setLogPanels((current) => ({ ...current, [logKey]: { status: 'no-process' } }));
      return;
    }
    setLogPanels((current) => ({ ...current, [logKey]: { status: 'loading', processId } }));
    const response = await fetch(
      `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/execution-processes/${encodeURIComponent(processId)}/logs?timeoutMs=1500&maxEntries=200`,
    );
    if (!response.ok) {
      throw new Error(await responseErrorMessage(response, 'Preview process logs failed'));
    }
    const result = await response.json() as { logs?: RawLogEntry[] };
    setLogPanels((current) => ({
      ...current,
      [logKey]: { status: 'loaded', processId, logs: result.logs ?? [] },
    }));
  }

  function showLogsWithErrorBoundary(logKey: string, processId: string | undefined) {
    void showLogs(logKey, processId).catch((err) => {
      setLogPanels((current) => ({
        ...current,
        [logKey]: {
          status: 'error',
          processId: processId ?? '',
          message: errorMessage(err),
        },
      }));
    });
  }

  async function openPreviewSlot(previewSlotId: string) {
    setMessage(null);
    setError(null);
    const params = new URLSearchParams();
    if (
      typeof window !== 'undefined' &&
      window.location.protocol === 'http:' &&
      window.location.hostname === 'localhost' &&
      new URLSearchParams(window.location.search).get('previewLocalCaddy') === '1'
    ) {
      params.set('baseDomain', 'localhost');
      params.set('localOrigin', window.location.origin);
    }
    const query = params.toString();
    const response = await fetch(
      `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(previewSlotId)}/url${query ? `?${query}` : ''}`,
    );
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Preview URL generation failed'));
    const result = await response.json() as { url: string };
    window.open(result.url, '_blank', 'noopener,noreferrer');
    setMessage(result.url);
  }

  return (
    <div className="h-full overflow-auto bg-neutral-950 text-neutral-100 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">PreviewServer</h1>
          <p className="text-sm text-neutral-400">
            Minimal V1 controls for stored run configs, preview slots, and canonical Preview URLs.
          </p>
        </header>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {message ? <Notice tone="info">{message}</Notice> : null}
        {deepLinkedWorkspaceId && deepLinkedWorkspaceId !== workspaceId ? (
          <Notice tone="error">This logs link belongs to another workspace. Open workspace {deepLinkedWorkspaceId} and try again.</Notice>
        ) : null}
        {workspaceRepos.length === 0 ? (
          <Notice tone="info">
            No repositories are available for this workspace yet. Add or open a workspace repo before creating PreviewServer run configs or preview slots.
          </Notice>
        ) : null}

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <h2 className="font-medium">Repository</h2>
          <p className="mt-1 text-sm text-neutral-400">
            PreviewServer will use the selected workspace repo internally for new run configs and preview slots.
          </p>
          <div className="mt-3 max-w-xl">
            <SelectInput
              label="Repository"
              value={selectedRepoId}
              options={repoOptions}
              disabled={repoOptions.length === 0}
              onChange={setSelectedRepoId}
            />
            {selectedRepo ? (
              <p className="mt-2 text-xs text-neutral-500">
                Using {formatRepoLabel(selectedRepo)}
              </p>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <h2 className="font-medium">Create preview slot</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <SelectInput
              label="Run config"
              value={slotForm.runConfigId}
              options={selectedRepoRunConfigs.map((item) => ({ id: item.id, label: `${item.name} (${item.slug})` }))}
              disabled={!hasSelectedRepo || selectedRepoRunConfigs.length === 0}
              onChange={(runConfigId) => setSlotForm((current) => ({ ...current, runConfigId }))}
            />
            <TextInput label="Slot slug" value={slotForm.slotSlug} onChange={(slotSlug) => setSlotForm((current) => ({ ...current, slotSlug }))} />
            <TextInput label="Title" value={slotForm.title} onChange={(title) => setSlotForm((current) => ({ ...current, title }))} />
          </div>
          <TextArea label="Preview slot description" value={slotForm.description} onChange={(description) => setSlotForm((current) => ({ ...current, description }))} />
          {hasSelectedRepo && selectedRepoRunConfigs.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-500">Create a run config for the selected repository before creating a preview slot.</p>
          ) : null}
          <button
            disabled={!hasSelectedRepo || !slotForm.runConfigId}
            className="mt-3 rounded bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            onClick={() => void upsertPreviewSlot().catch((err) => setError(errorMessage(err)))}
          >
            Save preview slot
          </button>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <div>
            <h2 className="font-medium">Preview slots</h2>
            <p className="text-sm text-neutral-400">Generate a named Preview URL or start the stored config.</p>
          </div>
          <ListEmpty items={previewSlots} label="No preview slots yet." />
          <div className="mt-3 space-y-2">
            {previewSlots.map((slot) => (
              <PreviewSlotRow
                key={slot.id}
                slot={slot}
                highlighted={deepLinkedSlotId === slot.id}
                repoLabel={repoLabelsById.get(slot.repo_id) ?? 'unavailable'}
                runConfigLabel={runConfigLabelsById.get(slot.run_config_id) ?? 'unavailable'}
                processLink={previewSlotProcessLinks[slot.id]}
                processId={previewSlotProcessLinks[slot.id]?.execution_process_id ?? previewSlotProcessIds[slot.id]}
                action={previewSlotActions[slot.id]}
                logState={logPanels[`slot:${slot.id}`]}
                onStart={() => void startPreviewSlot(slot.id).catch((err) => setError(errorMessage(err)))}
                onStop={() => void stopPreviewSlot(slot).catch((err) => setError(errorMessage(err)))}
                onRestart={() => void restartPreviewSlot(slot).catch((err) => setError(errorMessage(err)))}
                onOpen={() => void openPreviewSlot(slot.id).catch((err) => setError(errorMessage(err)))}
                onLogs={() => showLogsWithErrorBoundary(`slot:${slot.id}`, previewSlotProcessLinks[slot.id]?.execution_process_id ?? previewSlotProcessIds[slot.id])}
                onDelete={() => void deletePreviewSlot(slot).catch((err) => setError(errorMessage(err)))}
              />
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <h2 className="font-medium">Create or update stored run config</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Saving a slug that already exists for the selected repository updates that run config.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput label="Slug" value={runForm.slug} onChange={(slug) => setRunForm((current) => ({ ...current, slug }))} />
            <TextInput label="Name" value={runForm.name} onChange={(name) => setRunForm((current) => ({ ...current, name }))} />
            <label className="text-sm">
              <span className="block text-neutral-300">Kind</span>
              <select
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-100"
                value={runForm.kind}
                onChange={(event) => setRunForm((current) => ({ ...current, kind: event.target.value as RunConfigKind }))}
              >
                <option value="long_running">Long running</option>
                <option value="one_shot">One-shot</option>
                <option value="test">Test</option>
              </select>
            </label>
          </div>
          <TextArea label="Run config description" value={runForm.description} onChange={(description) => setRunForm((current) => ({ ...current, description }))} />
          <TextArea label="Command" value={runForm.command} monospace onChange={(command) => setRunForm((current) => ({ ...current, command }))} />
          {matchingRunConfig ? (
            <p className="mt-2 text-xs text-neutral-500">
              Saving will update existing run config {formatRunConfigLabel(matchingRunConfig)}.
            </p>
          ) : null}
          <button
            disabled={!hasSelectedRepo}
            className="mt-3 rounded bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            onClick={() => void upsertRunConfig().catch((err) => setError(errorMessage(err)))}
          >
            Save run config
          </button>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <h2 className="font-medium">Run configs</h2>
          <ListEmpty items={runConfigs} label="No run configs yet." />
          <div className="mt-3 space-y-2">
            {runConfigs.map((runConfig) => (
              <div key={runConfig.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-800 p-3">
                <div>
                  <div className="font-medium">{runConfig.name} <span className="text-neutral-500">/{runConfig.slug}</span></div>
                  {runConfig.description ? <p className="text-sm text-neutral-300">{runConfig.description}</p> : null}
                  <code className="text-xs text-neutral-400">{runConfig.command}</code>
                </div>
                <div className="flex gap-2">
                  <button className="rounded border border-neutral-700 px-3 py-1 text-sm" onClick={() => void startRunConfig(runConfig.id).catch((err) => setError(errorMessage(err)))}>
                    Run on demand
                  </button>
                  <button className="rounded border border-neutral-700 px-3 py-1 text-sm" aria-label={`Show logs for run config ${runConfig.name}`} onClick={() => showLogsWithErrorBoundary(`run:${runConfig.id}`, runConfigProcessIds[runConfig.id])}>
                    Logs
                  </button>
                  <button className="rounded border border-red-800 px-3 py-1 text-sm text-red-200" aria-label={`Delete run config ${runConfig.name}`} onClick={() => void deleteRunConfig(runConfig).catch((err) => setError(errorMessage(err)))}>
                    Delete
                  </button>
                </div>
                <LogPanel state={logPanels[`run:${runConfig.id}`]} />
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

function PreviewSlotRow({
  slot,
  highlighted,
  repoLabel,
  runConfigLabel,
  processLink,
  processId,
  action,
  logState,
  onStart,
  onStop,
  onRestart,
  onOpen,
  onLogs,
  onDelete,
}: {
  slot: PreviewSlot;
  highlighted: boolean;
  repoLabel: string;
  runConfigLabel: string;
  processLink: PreviewProcessLink | undefined;
  processId: string | undefined;
  action: SlotActionState | undefined;
  logState: LogPanelState | undefined;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpen: () => void;
  onLogs: () => void;
  onDelete: () => void;
}) {
  const running = processLink ? isRunningPreviewLink(processLink) : false;
  const busy = Boolean(action);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 ${highlighted ? 'border-blue-500 bg-blue-950/20' : 'border-neutral-800'}`}>
      <div>
        <div className="font-medium">{slot.title} <span className="text-neutral-500">/{slot.slot_slug}</span></div>
        {slot.description ? <p className="text-sm text-neutral-300">{slot.description}</p> : null}
        <div className="text-xs text-neutral-500">
          Repo {repoLabel} · Run config {runConfigLabel}
        </div>
        <p className="mt-1 text-xs text-neutral-400">{formatSlotProcessStatus(processLink, processId, action)}</p>
      </div>
      <div className="flex gap-2">
        <button className="rounded border border-neutral-700 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:text-neutral-500" disabled={busy} onClick={onStart}>Start</button>
        <button className="rounded border border-neutral-700 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:text-neutral-500" disabled={busy || !running} aria-label={`Stop preview slot ${slot.title}`} onClick={onStop}>Stop</button>
        <button className="rounded border border-neutral-700 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:text-neutral-500" disabled={busy} aria-label={`Restart preview slot ${slot.title}`} onClick={onRestart}>Restart</button>
        <button className="rounded border border-neutral-700 px-3 py-1 text-sm" onClick={onOpen}>Open URL</button>
        <button className="rounded border border-neutral-700 px-3 py-1 text-sm" aria-label={`Show logs for preview slot ${slot.title}`} onClick={onLogs}>Logs</button>
        <button className="rounded border border-red-800 px-3 py-1 text-sm text-red-200" aria-label={`Delete preview slot ${slot.title}`} onClick={onDelete}>Delete</button>
      </div>
      <LogPanel state={logState} />
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="block text-neutral-300">{label}</span>
      <input className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-100" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectInput({ label, value, options, disabled = false, onChange }: { label: string; value: string; options: RepoOption[]; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="block text-neutral-300">{label}</span>
      <select className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-500" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select…</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, monospace = false, onChange }: { label: string; value: string; monospace?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-sm">
      <span className="block text-neutral-300">{label}</span>
      <textarea className={`mt-1 min-h-20 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-100${monospace ? ' font-mono' : ''}`} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <div className={tone === 'error' ? 'rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-100' : 'rounded border border-blue-800 bg-blue-950/50 p-3 text-sm text-blue-100'}>
      {children}
    </div>
  );
}

function LogPanel({ state }: { state: LogPanelState | undefined }) {
  if (!state) return null;
  if (state.status === 'no-process') {
    return (
      <div className="w-full rounded border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-400">
        No process has been started from this PreviewServer panel yet. Start this item, then click Logs again.
      </div>
    );
  }
  if (state.status === 'loading') {
    return (
      <div className="w-full rounded border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-400">
        Loading recent logs for process <code>{state.processId}</code>…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="w-full rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-100">
        {state.message || 'Preview process logs failed'}
      </div>
    );
  }
  if (state.logs.length === 0) {
    return (
      <div className="w-full rounded border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-400">
        No logs were available for process <code>{state.processId}</code> yet.
      </div>
    );
  }
  return (
    <pre className="w-full max-h-80 overflow-auto whitespace-pre-wrap rounded border border-neutral-800 bg-black p-3 text-xs leading-5 text-neutral-100">
      {state.logs.map((entry, index) => {
        const prefix = entry.type === 'STDERR' ? '[stderr] ' : '';
        return `${index > 0 ? '\n' : ''}${prefix}${entry.content}`;
      })}
    </pre>
  );
}

function ListEmpty<T>({ items, label }: { items: T[]; label: string }) {
  return items.length === 0 ? <p className="mt-3 text-sm text-neutral-500">{label}</p> : null;
}

function formatRepoLabel(repo: RepoWithBranch): string {
  const displayName = repo.display_name || repo.name || 'Repository unavailable';
  return repo.target_branch
    ? `${displayName} (${repo.target_branch})`
    : displayName;
}

function formatRunConfigLabel(runConfig: RunConfig): string {
  return runConfig.name
    ? `${runConfig.name} (${runConfig.slug})`
    : runConfig.slug || 'Run config unavailable';
}

function isRunningPreviewLink(link: PreviewProcessLink): boolean {
  return link.status_snapshot === 'starting' || link.status_snapshot === 'ready';
}

function markLinkStopped(link: PreviewProcessLink | undefined, processId: string): PreviewProcessLink {
  const now = new Date().toISOString();
  return {
    ...(link ?? {
      id: '',
      workspace_id: '',
      repo_id: '',
      run_config_id: '',
      execution_process_id: processId,
      assigned_port: 0,
      started_at: now,
    }),
    status_snapshot: 'stopped',
    updated_at: now,
    ended_at: now,
  };
}

function formatSlotProcessStatus(
  link: PreviewProcessLink | undefined,
  processId: string | undefined,
  action: SlotActionState | undefined,
): string {
  if (action === 'stopping') return 'Stopping preview slot process…';
  if (action === 'restarting') return 'Restarting preview slot process…';
  if (!processId) return 'No linked preview slot process.';
  if (!link) return 'Process linked. Logs load only after you click Logs.';
  if (link.status_snapshot === 'starting') return 'Process starting.';
  if (link.status_snapshot === 'ready') return 'Process ready.';
  if (link.status_snapshot === 'failed') return 'Process failed. Logs remain available.';
  return 'Process stopped. Logs remain available.';
}

function clearRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
  } catch {
    // Fall through to the plain response body below.
  }
  return text;
}
