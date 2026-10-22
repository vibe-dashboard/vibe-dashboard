import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/vk-test.yml', 'utf8'));
const selection = workflow.jobs['coding-agent-upgrade-gate'].steps.find(
  (step: { id?: string }) => step.id === 'should_run',
).run;
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vk-agent-gate-'));
  dirs.push(root);
  mkdirSync(join(root, 'vibe-kanban'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  const commit = (file: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'fixture\n');
    git('add', file);
    git('-c', 'user.name=Gate test', '-c', 'user.email=gate@example.invalid', 'commit', '--quiet', '-m', file);
    return git('rev-parse', 'HEAD');
  };
  const base = commit('README.md');
  return {
    base, commit,
    select: (head: string, before = base) => {
      const output = join(root, 'output');
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-c', selection], {
        cwd: join(root, 'vibe-kanban'), encoding: 'utf8',
        env: { ...process.env, BASE_SHA: before, HEAD_SHA: head, GITHUB_OUTPUT: output },
      });
      return { status: result.status, output: readFileSync(output, 'utf8') };
    },
  };
}

it('selects executor and MCP changes using monorepo paths from the vendored directory', () => {
  for (const file of ['vibe-kanban/crates/executors/src/agent.rs', 'vibe-kanban/crates/mcp/Cargo.toml', 'vibe-kanban/Cargo.lock', '.github/workflows/vk-test.yml']) {
    const repo = fixture();
    expect(repo.select(repo.commit(file))).toEqual({ status: 0, output: 'result=true\n' });
  }
});

it('does not select an unrelated dashboard change', () => {
  const repo = fixture();
  expect(repo.select(repo.commit('src/dashboard.ts'))).toEqual({ status: 0, output: 'result=false\n' });
});

it('compares a new branch against the empty tree and fails closed for unavailable history', () => {
  const repo = fixture();
  const head = repo.commit('vibe-kanban/Cargo.toml');
  expect(repo.select(head, '0'.repeat(40))).toEqual({ status: 0, output: 'result=true\n' });
  const missing = repo.select(head, 'f'.repeat(40));
  expect(missing.status).not.toBe(0);
  expect(missing.output).toBe('');
});
