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
      'this server has no ssh key. run `server key <name> <path to private key>` (or set identity = "<path>" in ~/.kumiko/config.toml) so git can reach the server.',
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

export async function remoteWorktreeBranch(entry: ServerEntry, projectName: string): Promise<string | undefined> {
  validateProjectName(projectName);
  const work = `"$HOME/kumiko/projects/${projectName}"`;
  const result = await sshExec(entry, `git -C ${work} rev-parse --abbrev-ref HEAD`);
  const branch = result.stdout.trim();
  return branch && branch !== 'HEAD' ? branch : undefined;
}

/**
 * Commit tracked changes made on the server, then push them to the bare repo so
 * the local project can fetch them. Untracked files (build output like `dist/`)
 * are intentionally left alone.
 */
export async function serverCommitAndPush(entry: ServerEntry, projectName: string, branch: string): Promise<string> {
  validateProjectName(projectName);
  const work = `"$HOME/kumiko/projects/${projectName}"`;
  const message = `kumiko: server changes ${new Date().toISOString()}`;
  const result = await sshExec(
    entry,
    `cd ${work} && if [ -n "$(git status --porcelain --untracked-files=no)" ]; then git add -u && git -c user.name=kumiko -c user.email=kumiko@localhost commit -q -m ${shQuote(message)}; fi && git push -q origin ${shQuote(branch)} && git rev-parse HEAD`,
  );
  const sha = result.stdout.trim();
  if (!sha) throw new Error('the server did not report a commit for the pull');
  return sha;
}

const KUMIKO_IDENTITY = '-c user.name=kumiko -c user.email=kumiko@localhost';

function stdoutLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface MergeBranchResult {
  kind: 'merged' | 'dirty' | 'conflict' | 'error';
  files: string[];
  message?: string;
}

/**
 * Merge a child branch into its parent on the server. The project worktree is
 * restored to `restoreRef` afterwards, whatever the outcome.
 */
export async function serverMergeBranch(
  entry: ServerEntry,
  projectName: string,
  childRef: string,
  parentRef: string,
  restoreRef: string,
): Promise<MergeBranchResult> {
  validateProjectName(projectName);
  const work = `"$HOME/kumiko/projects/${projectName}"`;
  const script = [
    `cd ${work}`,
    `if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo DIRTY; exit 0; fi`,
    `git fetch --prune origin >/dev/null 2>&1 || { echo FETCH_FAILED; exit 0; }`,
    `git checkout -q -f -B ${shQuote(parentRef)} origin/${shQuote(parentRef)} >/dev/null 2>&1 || { echo CHECKOUT_FAILED; exit 0; }`,
    `if git ${KUMIKO_IDENTITY} merge --no-edit -q origin/${shQuote(childRef)} >/dev/null 2>&1; then`,
    `  if git push -q origin ${shQuote(parentRef)} >/dev/null 2>&1; then echo MERGED; else echo PUSH_FAILED; fi`,
    `else`,
    `  echo CONFLICT;`,
    `  git diff --name-only --diff-filter=U;`,
    `  git merge --abort >/dev/null 2>&1 || true;`,
    `fi`,
    `git checkout -q -f -B ${shQuote(restoreRef)} origin/${shQuote(restoreRef)} >/dev/null 2>&1 || true`,
  ].join('\n');
  const result = await sshExec(entry, script);
  const lines = stdoutLines(result.stdout);
  if (lines[0] === 'DIRTY') {
    return { kind: 'dirty', files: [], message: 'the remote workspace has uncommitted changes' };
  }
  if (lines.includes('MERGED')) return { kind: 'merged', files: [] };
  const conflictIndex = lines.indexOf('CONFLICT');
  if (conflictIndex >= 0) {
    return { kind: 'conflict', files: lines.slice(conflictIndex + 1) };
  }
  const failed = lines.find((line) => /^[A-Z_]+$/.test(line) && line !== 'MERGED');
  return { kind: 'error', files: [], message: failed ?? result.stderr.trim() ?? 'the server merge failed' };
}

export interface PropagateChildrenResult {
  kind: 'ok' | 'conflict' | 'error';
  updated: string[];
  conflictBranch?: string;
  files: string[];
  message?: string;
}

/**
 * Push a synced parent commit onto each child branch on the server. Child
 * commits are preserved (a merge, not a reset); a conflict stops propagation
 * and restores the worktree.
 */
export async function serverPropagateChildren(
  entry: ServerEntry,
  projectName: string,
  sourceRef: string,
  childRefs: string[],
  restoreRef: string,
): Promise<PropagateChildrenResult> {
  if (childRefs.length === 0) return { kind: 'ok', updated: [], files: [] };
  validateProjectName(projectName);
  const work = `"$HOME/kumiko/projects/${projectName}"`;
  const branches = childRefs.map((ref) => shQuote(ref)).join(' ');
  const restore = `git checkout -q -f -B ${shQuote(restoreRef)} origin/${shQuote(restoreRef)} >/dev/null 2>&1 || true`;
  const script = [
    `cd ${work}`,
    `if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo DIRTY; exit 0; fi`,
    `git fetch --prune origin >/dev/null 2>&1 || { echo FETCH_FAILED; exit 0; }`,
    `for b in ${branches}; do`,
    `  git checkout -q -f -B "$b" origin/"$b" >/dev/null 2>&1 || { echo "CHECKOUT_FAILED $b"; break; }`,
    `  if git ${KUMIKO_IDENTITY} merge --no-edit -q origin/${shQuote(sourceRef)} >/dev/null 2>&1; then`,
    `    if git push -q origin "$b" >/dev/null 2>&1; then echo "OK $b"; else echo "PUSH_FAILED $b"; break; fi`,
    `  else`,
    `    echo "CONFLICT $b";`,
    `    git diff --name-only --diff-filter=U;`,
    `    git merge --abort >/dev/null 2>&1 || true;`,
    `    ${restore}`,
    `    exit 0;`,
    `  fi`,
    `done`,
    restore,
  ].join('\n');
  const result = await sshExec(entry, script);
  const lines = stdoutLines(result.stdout);
  if (lines[0] === 'DIRTY') {
    return { kind: 'error', updated: [], files: [], message: 'the remote workspace has uncommitted changes' };
  }
  const conflictLine = lines.find((line) => line.startsWith('CONFLICT '));
  if (conflictLine) {
    const conflictBranch = conflictLine.slice('CONFLICT '.length).trim();
    const conflictIndex = lines.indexOf(conflictLine);
    return { kind: 'conflict', updated: [], conflictBranch, files: lines.slice(conflictIndex + 1) };
  }
  const failed = lines.find((line) => line.startsWith('CHECKOUT_FAILED ') || line.startsWith('PUSH_FAILED ') || line === 'FETCH_FAILED');
  if (failed) {
    return { kind: 'error', updated: [], files: [], message: `the server failed to update a child branch (${failed})` };
  }
  const updated = lines.filter((line) => line.startsWith('OK ')).map((line) => line.slice(3));
  return { kind: 'ok', updated, files: [] };
}
