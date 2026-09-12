import { execFileSync } from 'node:child_process';

export function buildRevision(): string | null {
  // Read only Git metadata. Never inspect the environment or publish local paths.
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[0-9a-f]{40}$/.test(revision) && !dirty ? revision : null;
  } catch { return null; }
}
