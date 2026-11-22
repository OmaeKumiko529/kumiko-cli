import { execFileSync } from 'node:child_process';

interface GitOptions {
  env?: Record<string, string>;
}

function runGit(dir: string, args: string[], options: GitOptions = {}): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...options.env },
  }).trim();
}

export function gitCurrentBranch(dir: string): string | undefined {
  try {
    const out = runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return out && out !== 'HEAD' ? out : undefined;
  } catch {
    return undefined;
  }
}

export function isGitRepo(dir: string): boolean {
  try {
    runGit(dir, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

export function gitDirtyCount(dir: string): number | undefined {
  try {
    const out = runGit(dir, ['status', '--porcelain']);
    return out.split('\n').filter((line) => line.trim().length > 0).length;
  } catch {
    return undefined;
  }
}

export function gitDirtyFiles(dir: string): string[] | undefined {
  try {
    const out = runGit(dir, ['status', '--porcelain']);
    return out
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const file = line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim();
        const arrow = file.indexOf(' -> ');
        return arrow >= 0 ? file.slice(arrow + 4) : file;
      });
  } catch {
    return undefined;
  }
}

export function gitInitMain(dir: string): void {
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function gitAddAllAndCommit(dir: string, message: string): string {
  runGit(dir, ['add', '-A']);
  runGit(dir, ['commit', '-m', message]);
  return runGit(dir, ['rev-parse', 'HEAD']);
}

export function gitHeadSha(dir: string): string | undefined {
  try {
    return runGit(dir, ['rev-parse', 'HEAD']);
  } catch {
    return undefined;
  }
}

export function gitShowCommitFiles(dir: string, sha: string): string[] {
  try {
    const out = runGit(dir, ['show', '--name-only', '--format=', '--no-renames', sha]);
    return out.split('\n').filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

export interface PushOptions {
  url: string;
  branch: string;
  force?: boolean;
  sshCommand?: string;
}

export function gitPush(dir: string, options: PushOptions): void {
  const args = ['push'];
  if (options.force) args.push('--force');
  args.push(options.url, `${options.branch}:${options.branch}`);
  runGit(dir, args, options.sshCommand ? { env: { GIT_SSH_COMMAND: options.sshCommand } } : {});
}

export interface FetchOptions {
  url: string;
  branch: string;
  sshCommand?: string;
}

export function gitFetch(dir: string, options: FetchOptions): string {
  runGit(dir, ['fetch', '--no-tags', options.url, options.branch], options.sshCommand ? { env: { GIT_SSH_COMMAND: options.sshCommand } } : {});
  return runGit(dir, ['rev-parse', 'FETCH_HEAD']);
}

export function gitResolveRef(dir: string, ref: string): string | undefined {
  try {
    return runGit(dir, ['rev-parse', ref]);
  } catch {
    return undefined;
  }
}

export function gitTrackedDirtyCount(dir: string): number | undefined {
  try {
    const out = runGit(dir, ['status', '--porcelain', '--untracked-files=no']);
    return out.split('\n').filter((line) => line.trim().length > 0).length;
  } catch {
    return undefined;
  }
}

export function gitDiffFileNames(dir: string, from: string, to: string): string[] {
  try {
    const out = runGit(dir, ['diff', '--name-only', '--no-renames', from, to]);
    return out.split('\n').filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

export function gitMergeFfOnly(dir: string, ref: string): void {
  runGit(dir, ['merge', '--ff-only', ref]);
}

export function gitResetHard(dir: string, ref: string): void {
  runGit(dir, ['reset', '--hard', ref]);
}

export function gitBranchExists(dir: string, ref: string): boolean {
  try {
    runGit(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`]);
    return true;
  } catch {
    return false;
  }
}

export function gitCreateBranch(dir: string, ref: string): void {
  runGit(dir, ['branch', ref]);
}

export function gitCheckout(dir: string, ref: string): void {
  runGit(dir, ['checkout', '-q', ref]);
}

/** Fast-forward a local branch ref from the server after a server-side merge. */
export function gitFetchLocalBranch(dir: string, options: FetchOptions): void {
  runGit(
    dir,
    ['fetch', '-q', '--no-tags', '--update-head-ok', options.url, `${options.branch}:${options.branch}`],
    options.sshCommand ? { env: { GIT_SSH_COMMAND: options.sshCommand } } : {},
  );
}
