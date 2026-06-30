import React, { useEffect, useMemo, useState } from 'react';
import { vkClient } from '../lib/vk-client';
import {
  buildOpenRouterSettingsPath,
  createOpenRouterVariantKey,
  getOpenRouterModelForVariant,
  mergeOpenRouterModelsIntoProfiles,
  parseProfilesContent,
  stringifyProfiles,
  type OpenRouterModelSummary,
} from '../lib/openrouterProfiles';

interface OpenRouterModel extends OpenRouterModelSummary {
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  supported_parameters?: string[];
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

function formatPrice(value: string | undefined): string {
  if (!value) return '—';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  if (parsed === 0) return 'Free';
  return `$${(parsed * 1_000_000).toFixed(2)}/M`;
}

function formatContext(contextLength: number | undefined): string {
  if (!contextLength) return '—';
  if (contextLength >= 1_000_000) {
    return `${(contextLength / 1_000_000).toFixed(1)}M`;
  }
  if (contextLength >= 1_000) {
    return `${Math.round(contextLength / 1_000)}K`;
  }
  return String(contextLength);
}

export function OpenRouterModelChooser() {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [installedVariants, setInstalledVariants] = useState<Record<string, string>>({});

  const refreshInstalledProfiles = async () => {
    const profilesContent = await vkClient.getProfiles();
    const profiles = parseProfilesContent(profilesContent.content);
    const installed: Record<string, string> = {};
    for (const model of models) {
      const variantKey = createOpenRouterVariantKey(model.id);
      const storedModel = getOpenRouterModelForVariant(profiles, variantKey);
      if (storedModel === `openrouter/${model.id.replace(/^openrouter\//i, '')}`) {
        installed[model.id] = variantKey;
      }
    }
    setInstalledVariants(installed);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          'https://openrouter.ai/api/v1/models?output_modalities=text&sort=most-popular',
        );
        if (!response.ok) {
          throw new Error(`OpenRouter catalog failed: ${response.statusText}`);
        }
        const payload = (await response.json()) as OpenRouterModelsResponse;
        if (!cancelled) {
          setModels(payload.data || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load OpenRouter models.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!models.length) return;
    void refreshInstalledProfiles().catch(() => {
      // Non-fatal: users can still attempt to add models and see save errors.
    });
  }, [models]);

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? models.filter((model) =>
          [model.id, model.name, model.description]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(normalizedQuery)),
        )
      : models;
    return filtered.slice(0, 80);
  }, [models, query]);

  const selectedModels = useMemo(
    () => models.filter((model) => selectedIds.has(model.id)),
    [models, selectedIds],
  );

  const toggleSelected = (modelId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const addSelectedModels = async () => {
    if (!selectedModels.length) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const profilesContent = await vkClient.getProfiles();
      const profiles = parseProfilesContent(profilesContent.content);
      const result = mergeOpenRouterModelsIntoProfiles(profiles, selectedModels);
      if (result.addedVariantKeys.length > 0) {
        await vkClient.saveProfiles(stringifyProfiles(result.profiles));
      }
      await refreshInstalledProfiles();
      setSelectedIds(new Set());
      const added = result.addedVariantKeys.length;
      const existing = result.existingVariantKeys.length;
      setSuccess(
        added > 0
          ? `Added ${added} OpenRouter model${added === 1 ? '' : 's'} to VK OpenCode configs${
              existing ? ` (${existing} already existed)` : ''
            }.`
          : 'All selected models already exist as VK OpenCode configs.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save VK profiles.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-zinc-950 p-6 text-zinc-100 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-violet-300">
            OpenRouter → VK OpenCode
          </p>
          <h1 className="text-2xl font-bold text-white">Choose OpenRouter Models</h1>
          <p className="max-w-3xl text-sm text-zinc-400">
            Select models from OpenRouter’s catalog. Each selection is saved as a
            VK <span className="font-medium text-zinc-200">OPENCODE</span> agent
            configuration using model IDs like <code>openrouter/provider/model</code>.
          </p>
        </header>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 shadow-xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models, providers, descriptions…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-400 md:max-w-md"
            />
            <button
              type="button"
              disabled={!selectedModels.length || saving}
              onClick={() => void addSelectedModels()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {saving
                ? 'Adding…'
                : `Add selected${selectedModels.length ? ` (${selectedModels.length})` : ''}`}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
          {success && (
            <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {success}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-300" />
            </div>
          ) : visibleModels.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500">
              No matching models.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {visibleModels.map((model) => {
                const variantKey = installedVariants[model.id];
                const selected = selectedIds.has(model.id);
                const supportsTools = model.supported_parameters?.includes('tools');
                return (
                  <div
                    key={model.id}
                    className="grid gap-3 p-4 transition hover:bg-zinc-800/40 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <label className="flex min-w-0 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(model.id)}
                        disabled={Boolean(variantKey)}
                        className="mt-1 h-4 w-4 accent-violet-500"
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="block truncate font-medium text-white">
                          {model.name || model.id}
                        </span>
                        <code className="block truncate text-xs text-violet-300">
                          {model.id}
                        </code>
                        {model.description && (
                          <span className="line-clamp-2 block text-sm text-zinc-400">
                            {model.description}
                          </span>
                        )}
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 md:justify-end">
                      <span className="rounded-full bg-zinc-800 px-2 py-1">
                        ctx {formatContext(model.context_length)}
                      </span>
                      <span className="rounded-full bg-zinc-800 px-2 py-1">
                        in {formatPrice(model.pricing?.prompt)}
                      </span>
                      <span className="rounded-full bg-zinc-800 px-2 py-1">
                        out {formatPrice(model.pricing?.completion)}
                      </span>
                      {supportsTools && (
                        <span className="rounded-full bg-blue-500/15 px-2 py-1 text-blue-200">
                          tools
                        </span>
                      )}
                      {variantKey ? (
                        <a
                          href={buildOpenRouterSettingsPath(variantKey)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-200 hover:bg-emerald-500/20"
                        >
                          Edit Settings
                        </a>
                      ) : (
                        <span className="rounded-full bg-zinc-800 px-2 py-1">
                          {createOpenRouterVariantKey(model.id)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
