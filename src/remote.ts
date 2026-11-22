import { sshExec } from './ssh.js';
import type { ServerEntry } from './types.js';

const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateProjectName(name: string): void {
  if (!PROJECT_NAME_PATTERN.test(name)) {
    throw new Error(
      `project name '${name}' cannot be used as a remote workspace (letters, digits, '.', '_' and '-' only)`,
    );
  }
}

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function remoteHome(entry: ServerEntry): Promise<string> {
  const result = await sshExec(entry, 'echo "$HOME"');
  const home = result.stdout.trim();
  if (!home) throw new Error('could not resolve the remote home directory');
  return home;
}

export function pushUrlFor(entry: ServerEntry, remoteHomePath: string, projectName: string): string {
  return `ssh://${entry.user}@${entry.host}:${entry.port}${remoteHomePath}/kumiko/repos/${projectName}.git`;
}

/** Command used by git for the transport, so pushes reuse the configured key instead of asking for a password. */
export function sshCommandFor(entry: ServerEntry): string {
  if (!entry.identity) {
    throw new Error(
      'sync needs an ssh key. Set `identity = "<path to private key>"` for this server in ~/.kumiko/config.toml.',
    );
  }
  const identity = entry.identity.replace(/\\/g, '/');
  return `ssh -i "${identity}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -p ${entry.port}`;
}

export async function ensureRemoteRepo(entry: ServerEntry, projectName: string): Promise<void> {
  validateProjectName(projectName);
  const repo = `"$HOME/kumiko/repos/${projectName}.git"`;
  await sshExec(
    entry,
    `mkdir -p "$HOME/kumiko/repos" "$HOME/kumiko/projects" && { [ -d ${repo} ] || git init --bare -q ${repo}; }`,
  );
}

export type RemoteWorktreeState = 'absent' | 'clean' | 'dirty';

export async function remoteWorktreeState(entry: ServerEntry, projectName: string): Promise<RemoteWorktreeState> {
  validateProjectName(projectName);
  const work = `"$HOME/kumiko/projects/${projectName}"`;
  // Untracked files are expected after a build (`dist/` etc.), so only tracked
  // modifications count as a dirty workspace.
  const result = await sshExec(
    entry,
    `if [ ! -d ${work}/.git ]; then echo ABSENT; elif [ -n "$(git -C ${work} status --porcelain --untracked-files=no)" ]; then echo DIRTY; else echo CLEAN; fi`,
  );
  const state = result.stdout.trim();
  return state === 'DIRTY' ? 'dirty' : state === 'CLEAN' ? 'clean' : 'absent';
}

export async function ensureRemoteWorktree(entry: ServerEntry, projectName: string): Promise<void> {
  validateProjectName(projectName);
  const repo = `"$HOME/kumiko/repos/${projectName}.git"`;
  const work = `"$HOME/kumiko/projects/${projectName}"`;
  await sshExec(entry, `if [ ! -d ${work}/.git ]; then git clone -q ${repo} ${work}; fi`);
}

export async function updateRemoteWorktree(entry: ServerEntry, projectName: string, branch: string): Promise<void> {
  validateProjectName(projectName);
  const work = `"$HOME/kumiko/projects/${projectName}"`;
  await sshExec(
    entry,
    `git -C ${work} fetch --prune origin && git -C ${work} checkout -q -f -B ${shQuote(branch)} origin/${shQuote(branch)}`,
  );
}
