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
