import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { config } from '../config.js';
import type { ExecutorProfiles, ReasoningCapabilities, Session } from '../types.js';
import { client } from './client.js';
import type { SendProfile } from './executor-profile.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

function isCapabilities(value: unknown): value is ReasoningCapabilities {
  if (!value || typeof value !== 'object') return false;
  const data = value as ReasoningCapabilities;
  return (data.model_id === null || typeof data.model_id === 'string')
    && (data.default_model === null || typeof data.default_model === 'string')
    && Array.isArray(data.models)
    && data.models.every(model => model && typeof model.id === 'string'
      && (model.provider_id == null || typeof model.provider_id === 'string')
      && Array.isArray(model.reasoning_options)
      && model.reasoning_options.every(option => option && typeof option.id === 'string'));
}

async function getCapabilities(
  profiles: ExecutorProfiles,
  profile: SendProfile,
  session: Session,
): Promise<ReasoningCapabilities> {
  const selected = profiles[profile.executor]?.[profile.variant];
  const defaultProfile = profiles[profile.executor]?.DEFAULT;
  // The existing discovery API uses the default preset's command/environment.
  // Do not use that catalog to validate a different executable or provider setup.
  const commandSettings = (preset: unknown) => {
    const agent = (preset as Record<string, Record<string, unknown>> | undefined)?.[profile.executor];
    return [agent?.base_command_override, agent?.additional_params, agent?.env];
  };
  if (!isDeepStrictEqual(commandSettings(selected), commandSettings(defaultProfile))) {
    throw new Error('capability discovery uses a different command/environment than this preset');
  }

  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const key = digest([config.BASE_URL, session.workspace_id, session.id, profile.executor, profile.variant]);
  const fingerprint = digest([selected, defaultProfile, session.agent_working_dir]);
  const directory = path.join(os.homedir(), '.cache', 'vibe-agent', 'reasoning');
  const file = path.join(directory, `${key}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    const age = Date.now() - cached.createdAt;
    if (cached.version === 1 && cached.fingerprint === fingerprint && age >= 0 && age < CACHE_TTL_MS
      && isCapabilities(cached.capabilities)) return cached.capabilities;
  } catch {
    // Missing, corrupt, or inaccessible cache: perform a fresh lookup.
  }

  const capabilities = await client.getReasoningCapabilities(profile, session);
  if (!isCapabilities(capabilities)) throw new Error('invalid capability metadata');
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, JSON.stringify({ version: 1, fingerprint, createdAt: Date.now(), capabilities }), { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch {
    // Cache failures must not prevent a verified override or the send itself.
    try { fs.unlinkSync(temp); } catch { /* Nothing to clean up. */ }
  }
  return capabilities;
}

export async function resolveSendReasoning(
  profiles: ExecutorProfiles,
  profile: SendProfile,
  session: Session,
): Promise<{ reasoning_id?: string }> {
  if (!profile.reasoning) return {};
  try {
    const capabilities = await getCapabilities(profiles, profile, session);
    const modelId = capabilities.model_id ?? capabilities.default_model;
    if (!modelId) throw new Error('the effective model could not be determined');
    const models = capabilities.models.filter(model =>
      (model.provider_id ? `${model.provider_id}/${model.id}` : model.id) === modelId);
    if (models.length !== 1) throw new Error(`capabilities for model "${modelId}" are unavailable or ambiguous`);
    const options = models[0].reasoning_options;
    const matches = options.filter(option => option.id.toLowerCase() === profile.reasoning!.toLowerCase());
    if (matches.length !== 1) {
      throw new Error(`model "${modelId}" does not advertise this level (available: ${options.map(option => option.id).join(', ') || 'none'})`);
    }
    return { reasoning_id: matches[0].id };
  } catch (error) {
    console.warn(`Keeping saved reasoning for ${profile.executor}/${profile.variant}; could not apply "${profile.reasoning}": ${(error as Error).message}`);
    return {};
  }
}
