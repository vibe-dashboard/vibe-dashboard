import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

/** Native development keeps its home default; Docker supplies /repos. */
export function getReposRoot(): string {
  const configured = process.env.REPOS_ROOT;
  if (!configured) return join(homedir(), 'repos');
  if (!isAbsolute(configured))
    throw new Error('REPOS_ROOT must be an absolute path.');
  return configured;
}
