import { execFileSync } from 'node:child_process';

export function gitCurrentBranch(dir: string): string | undefined {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out && out !== 'HEAD' ? out : undefined;
  } catch {
    return undefined;
  }
}

export function gitDirtyCount(dir: string): number | undefined {
  try {
    const out = execFileSync('git', ['-C', dir, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter((line) => line.trim().length > 0).length;
  } catch {
    return undefined;
  }
}
