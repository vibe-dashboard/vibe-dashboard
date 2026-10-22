import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('.github/scripts/publish-vk-release.sh');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

function publish(responses: Record<string, string[]>, extraEnv: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-vk-release-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'release-assets'));
  writeFileSync(join(dir, 'release-assets/manifest.json'), '{}');
  const state = join(dir, 'state.json');
  writeFileSync(state, JSON.stringify({ responses, calls: [], sleeps: [] }));
  writeFileSync(join(dir, 'sleep'), `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE, 'utf8'));
state.sleeps.push(Number(process.argv[2]));
fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(state));
`, { mode: 0o755 });
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE, 'utf8'));
const args = process.argv.slice(2);
const operation = args.slice(0, 2).join(' ');
state.calls.push(operation);
const response = state.responses[operation]?.shift() ?? 'ok';
fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(state));
if (operation === 'api rate_limit') {
  console.log(process.env.MOCK_RESET ?? Math.floor(Date.now() / 1000) - 1);
} else if (response !== 'ok') {
  console.error({ rate: 'HTTP 403: API rate limit exceeded', missing: 'release not found', forbidden: 'HTTP 403: Resource not accessible by integration', ambiguous404: 'HTTP 404: Not Found' }[response]);
  process.exit(1);
}
`, { mode: 0o755 });
  const result = spawnSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      MOCK_STATE: state,
      GH_TOKEN: 'test-token',
      VK_ASSET_REPOSITORY: 'example/assets',
      RELEASE_TAG: 'test-release',
      RELEASE_NAME: 'Test release',
      RELEASE_BODY: 'Test notes',
      GH_RELEASE_RETRY_DELAY_SECONDS: '0',
      ...extraEnv,
    },
  });
  const { calls, sleeps } = JSON.parse(readFileSync(state, 'utf8')) as { calls: string[]; sleeps: number[] };
  return { ...result, calls, sleeps };
}

it('retries rate-limited lookup, edit, and upload without creating a release', () => {
  const result = publish({
    'release view': ['rate', 'ok'],
    'release edit': ['rate', 'ok'],
    'release upload': ['rate', 'ok'],
  });
  expect(result.status).toBe(0);
  expect(result.calls).toEqual([
    'release view', 'api rate_limit', 'release view',
    'release edit', 'api rate_limit', 'release edit',
    'release upload', 'api rate_limit', 'release upload',
  ]);
});

it('creates only after a genuine missing release and retries rate-limited creation', () => {
  const result = publish({ 'release view': ['missing'], 'release create': ['rate', 'ok'] });
  expect(result.status).toBe(0);
  expect(result.calls).toEqual([
    'release view', 'release create', 'api rate_limit', 'release create', 'release upload',
  ]);
});

it('propagates authorization failures without creating or uploading', () => {
  const result = publish({ 'release view': ['forbidden'] });
  expect(result.status).toBe(1);
  expect(result.calls).toEqual(['release view']);
});

it('does not treat an ambiguous HTTP 404 as proof that the release is absent', () => {
  const result = publish({ 'release view': ['ambiguous404'] });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('HTTP 404: Not Found');
  expect(result.calls).toEqual(['release view']);
});

it('fails closed after bounded quota retries rather than treating exhaustion as absence', () => {
  const result = publish({ 'release view': ['rate', 'rate', 'rate'] });
  expect(result.status).toBe(1);
  expect(result.calls.filter(call => call === 'release view')).toHaveLength(3);
  expect(result.calls).not.toContain('release create');
  expect(result.calls).not.toContain('release upload');
});

it('stops when the reset time exceeds the retry budget', () => {
  const result = publish({ 'release view': ['rate'] }, {
    MOCK_RESET: String(Math.floor(Date.now() / 1000) + 60),
    GH_RELEASE_RETRY_BUDGET_SECONDS: '1',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('exceeds the release retry budget');
  expect(result.calls).toEqual(['release view', 'api rate_limit']);
});

it('waits until the reported quota reset before retrying', () => {
  const result = publish({ 'release view': ['rate', 'ok'] }, {
    MOCK_RESET: String(Math.floor(Date.now() / 1000) + 120),
  });
  expect(result.status).toBe(0);
  expect(result.sleeps).toHaveLength(1);
  expect(result.sleeps[0]).toBeGreaterThanOrEqual(120);
  expect(result.sleeps[0]).toBeLessThanOrEqual(122);
  expect(result.calls).not.toContain('release create');
});
