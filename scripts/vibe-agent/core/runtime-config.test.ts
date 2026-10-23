import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEND_PROFILE, readRuntimeExecutorProfile } from './runtime-config.js';

let directory: string;
let file: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-runtime-config-'));
  file = path.join(directory, 'vibe-agent.json');
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function writeConfig(executorProfile: unknown, version = 1) {
  fs.writeFileSync(file, JSON.stringify({ version, executorProfile }));
}

describe('runtime executor configuration', () => {
  it('uses the built-in default only when the file is absent, ignoring the retired env override', () => {
    vi.stubEnv('VIBE_AGENT_EXECUTOR_PROFILE', 'Codex,Default,high');
    expect(readRuntimeExecutorProfile(file)).toEqual(DEFAULT_SEND_PROFILE);
  });

  it('loads a structured profile, trims names, and preserves omitted reasoning', () => {
    writeConfig({ executor: ' Codex ', variant: ' High ' });
    expect(readRuntimeExecutorProfile(file)).toEqual({ executor: 'Codex', variant: 'High' });
  });

  it('rereads edits without a process restart or configuration cache', () => {
    writeConfig({ executor: 'OpenCode', variant: 'Default', reasoning: 'medium' });
    expect(readRuntimeExecutorProfile(file)).toEqual(DEFAULT_SEND_PROFILE);
    writeConfig({ executor: 'Codex', variant: 'Review', reasoning: 'high' });
    expect(readRuntimeExecutorProfile(file)).toEqual({ executor: 'Codex', variant: 'Review', reasoning: 'high' });
    writeConfig({ executor: 'Codex', variant: 'Review' });
    expect(readRuntimeExecutorProfile(file)).not.toHaveProperty('reasoning');
  });

  it.each([
    { value: null },
    { value: [] },
    { value: 'OpenCode,Default,medium' },
    { value: {} },
    { value: { executor: 'OpenCode' } },
    { value: { executor: '', variant: 'Default' } },
    { value: { executor: 'OpenCode', variant: '  ' } },
    { value: { executor: 12, variant: 'Default' } },
    { value: { executor: 'OpenCode', variant: 'Default', reasoning: null } },
    { value: { executor: 'OpenCode', variant: 'Default', reasoning: '' } },
    { value: { executor: 'OpenCode', variant: 'Default', reasoning: 12 } },
    { value: { executor: 'OpenCode', variant: 'Default', reasoning_id: 'medium' } },
  ])('rejects malformed profile %j with the file path in the error', ({ value }) => {
    writeConfig(value);
    expect(() => readRuntimeExecutorProfile(file)).toThrow(`Invalid vibe-agent config ${file}:`);
  });

  it('rejects malformed JSON rather than falling back to a different agent', () => {
    fs.writeFileSync(file, '{"version":1,');
    expect(() => readRuntimeExecutorProfile(file)).toThrow(`Invalid vibe-agent config ${file}:`);
  });

  it('rejects an unsupported config version', () => {
    writeConfig(DEFAULT_SEND_PROFILE, 2);
    expect(() => readRuntimeExecutorProfile(file)).toThrow('expected an object with version: 1');
  });

  it('does not treat an unreadable path as a missing configuration', () => {
    expect(() => readRuntimeExecutorProfile(directory)).toThrow(`Cannot read vibe-agent config ${directory}:`);
  });

  it('ships the same default in the first-startup seed template', () => {
    const example = JSON.parse(fs.readFileSync(new URL('../vibe-agent.example.json', import.meta.url), 'utf8'));
    expect(example).toEqual({ version: 1, executorProfile: DEFAULT_SEND_PROFILE });
  });
});
