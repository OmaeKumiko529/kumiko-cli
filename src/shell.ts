import path from 'node:path';
import { loadKnownProjects, loadProjectConfig } from './config.js';
import { shQuote } from './remote.js';
import { sshExec, sshExecStream } from './ssh.js';
import type { Repl } from './repl.js';
import type { ProjectConfig, ServerEntry, SessionState, ShellState } from './types.js';
import { noticeBadge, symbols } from './ui.js';

/**
 * Remote directory that backs the virtual shell root. Every native command runs
 * on the connected server below `$HOME/kumiko`, so the paths shown in the REPL
 * (`/projects/<name>`, `/logs`, ...) match the kumiko layout instead of the full
 * remote home directory.
 */
export const REMOTE_ROOT = '$HOME/kumiko';

const COMMOND_NOTICE =
  'A kumiko config include in repo. You can use kumiko commond to quickly get more efficient Git experience. ' +
  'To close this notice, use the kumiko setting commond.';

/** Tools that get their own uppercase prompt prefix, e.g. `GIT`, `NPM`. Others show as `LINUX`. */
const TOOL_LABELS: Record<string, string> = {
  git: 'GIT',
  npm: 'NPM',
  npx: 'NPX',
  pnpm: 'PNPM',
  yarn: 'YARN',
  bun: 'BUN',
  node: 'NODE',
  deno: 'DENO',
  docker: 'DOCKER',
  'docker-compose': 'DOCKER',
  podman: 'PODMAN',
  make: 'MAKE',
  cmake: 'CMAKE',
  python: 'PYTHON',
  python3: 'PYTHON',
  pip: 'PIP',
  pip3: 'PIP',
  go: 'GO',
  cargo: 'CARGO',
  rustc: 'RUSTC',
  java: 'JAVA',
  mvn: 'MVN',
  gradle: 'GRADLE',
  dotnet: 'DOTNET',
  gh: 'GH',
  curl: 'CURL',
  wget: 'WGET',
  tar: 'TAR',
  unzip: 'UNZIP',
  vim: 'VIM',
  nano: 'NANO',
  systemctl: 'SYSTEMCTL',
};

/** Uppercase prompt prefix for a native command, e.g. `git status` -> `GIT`, `ls` -> `LINUX`. */
export function nativeLabel(command: string): string {
  const name = path.posix.basename(command.replace(/\\/g, '/'));
  return TOOL_LABELS[name] ?? 'LINUX';
}

/**
 * Split a REPL line into arguments. Supports single/double quotes and
 * backslash-escapes so `switch "F:\My Projects\x"` and `commond commit "a b"`
 * keep working.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && index + 1 < input.length) {
        // Keep backslashes literal (Windows paths such as "F:\Projects\x" must
        // survive tokenization); only an escaped quote or backslash collapses.
        const next = input[index + 1] as string;
        if (next === quote || next === '\\') {
          current += next;
          index += 1;
        } else current += char;
      } else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    // Outside quotes a backslash is a normal character: native commands get the
    // raw line anyway, and kumiko paths on Windows keep their separators.
    current += char;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

/** The shell state defaults to a free terminal at the root (nothing selected yet). */
export function shellState(state: SessionState): ShellState {
  return state.shell ?? { mode: 'terminal', cwd: '' };
}

/** Display form of a virtual path: root is `/`, everything else is `/projects/x`. */
export function displayCwd(cwd: string): string {
  return cwd ? `/${cwd}` : '/';
}

/** Virtual path of a project workspace: `projects/<name>`. */
export function workspaceCwd(name: string): string {
  return `projects/${name}`;
}

/**
 * Resolve `raw` against `cwd` inside the virtual root. Absolute paths start at
 * the root, `~` is the root, `.`/`..` are handled. Returns null when the path
 * escapes above the root.
 */
export function resolveVirtualPath(cwd: string, raw: string): string | null {
  const expanded = raw === '~' || raw.startsWith('~/') ? raw.slice(1) : raw;
  const stack = expanded.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
  for (const part of expanded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

export interface ShellContext {
  repl: Repl;
}

interface ResolvedTarget {
  server: ServerEntry;
  cwd: string;
  /** Set when the shell cwd is the root of a project workspace. */
  workspace?: { name: string };
}

function requireServer(repl: Repl): ServerEntry | undefined {
  const server = repl.state.server;
  if (!server) {
    repl.error('no server connected. run `connect <server>` first to use shell commands.');
    return undefined;
  }
  return server.entry;
}

function resolveTarget(repl: Repl): ResolvedTarget | undefined {
  const shell = shellState(repl.state);
  const project = repl.state.project;
  if (shell.mode === 'kumiko' && project) {
    const server = requireServer(repl);
    if (!server) return undefined;
    if (!project.configuredOnServer) {
      repl.error(
        `the workspace '${project.name}' is not on the server yet. run \`sync\` first, ` +
          'or `switch current -terminal` to use the shell root.',
      );
      return undefined;
    }
    return { server, cwd: workspaceCwd(project.name), workspace: { name: project.name } };
  }
  const server = requireServer(repl);
  if (!server) return undefined;
  return { server, cwd: shell.cwd };
}

/** `cd` command for a virtual path, e.g. `cd "$HOME/kumiko"/'projects/testProject'`. */
function cdRoot(cwd: string): string {
  return cwd ? `cd "$HOME/kumiko"/${shQuote(cwd)}` : 'cd "$HOME/kumiko"';
}

/** Workspace root (`projects/<name>`) containing the cwd, if any. */
export function repoRootFor(cwd: string): string | null {
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] !== 'projects') return null;
  return `projects/${parts[1] as string}`;
}

function projectConfigFor(repoRoot: string, state: SessionState): ProjectConfig | null {
  const name = repoRoot.slice('projects/'.length);
  const current = state.project;
  const dir = current && current.name === name ? current.path : loadKnownProjects()[name];
  if (!dir) return null;
  try {
    return loadProjectConfig(dir);
  } catch {
    return null;
  }
}

const configCache = new Map<string, boolean>();

function configCacheKey(entry: ServerEntry, repoRoot: string): string {
  return `${entry.user}@${entry.host}:${entry.port}:${repoRoot}`;
}

/** Does the checked out workspace contain a .kumiko.toml? (cached per server + workspace) */
function hasKumikoConfig(entry: ServerEntry, repoRoot: string): Promise<boolean> {
  const key = configCacheKey(entry, repoRoot);
  const cached = configCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return sshExec(entry, `${cdRoot(repoRoot)} && test -f .kumiko.toml && echo yes`)
    .then((result) => {
      const exists = result.stdout.trim() === 'yes';
      configCache.set(key, exists);
      return exists;
    })
    .catch(() => false);
}

/** `kumiko setting commond off` turns this notice off for one project. */
function commondNoticeEnabled(repoRoot: string, state: SessionState): boolean {
  const config = projectConfigFor(repoRoot, state);
  return config?.settings?.commond !== false;
}

function renderListing(target: ResolvedTarget, entries: string[]): string[] {
  const header = target.workspace
    ? `${symbols.ok} ${target.workspace.name}`
    : target.cwd
      ? `${symbols.ok} ${path.posix.basename(target.cwd)}`
      : '[/]';
  const lines = [header];
  entries.forEach((entry, index) => {
    const last = index === entries.length - 1;
    lines.push(`${last ? '└──' : '├──'} ${entry.replace(/\/$/, '')}`);
  });
  return lines;
}

/** Bare `ls` renders the kumiko tree; `ls -la` and friends pass through to the server. */
async function listAsTree(repl: Repl, target: ResolvedTarget): Promise<void> {
  try {
    const result = await sshExec(target.server, `${cdRoot(target.cwd)} && ls -1Ap`);
    if (result.code !== 0) {
      repl.error(result.stderr.trim() || 'ls failed.');
      return;
    }
    const entries = result.stdout.split('\n').filter((line) => line.length > 0);
    repl.sayLines(renderListing(target, entries));
  } catch (err) {
    repl.error(`shell command failed: ${(err as Error).message}`);
  }
}

/**
 * Run a command that is not a kumiko command on the connected server. The shell
 * starts in the workspace root when a workspace is selected, otherwise in the
 * virtual cwd tracked by `cd`.
 */
export async function runNativeCommand(run: ShellContext, raw: string): Promise<void> {
  const { repl } = run;
  const tokens = tokenize(raw);
  const first = tokens[0] ?? '';
  if (!first) return;
  repl.setCommandPrefix(nativeLabel(first));

  const target = resolveTarget(repl);
  if (!target) return;

  if (first === 'ls' && tokens.length === 1) {
    await listAsTree(repl, target);
    return;
  }

  const repoRoot = repoRootFor(target.cwd);
  const notice =
    first === 'git' && repoRoot && commondNoticeEnabled(repoRoot, repl.state)
      ? hasKumikoConfig(target.server, repoRoot)
      : Promise.resolve(false);

  const command = `${cdRoot(target.cwd)} && bash -lc ${shQuote(raw.trim())}`;
  repl.beginStream();
  let code = 0;
  try {
    const result = await sshExecStream(target.server, command, (chunk) => repl.writeStream(chunk));
    code = result.code;
  } catch (err) {
    repl.error(`shell command failed: ${(err as Error).message}`);
    return;
  } finally {
    repl.endStream();
  }
  if (code !== 0) repl.error(`exit code ${code}.`);
  if (await notice) repl.say(`${noticeBadge()} ${COMMOND_NOTICE}`);
}

/**
 * `cd [<path>]` for the virtual shell. Disabled while the shell is pinned to a
 * workspace root; otherwise moves the cwd inside `$HOME/kumiko` on the server.
 */
export async function changeDirectory(run: ShellContext, raw: string): Promise<void> {
  const { repl } = run;
  const state = repl.state;
  const shell = shellState(state);
  const project = state.project;
  if (project && shell.mode === 'kumiko') {
    repl.error('cd command cannot be used when a workspace and branch have been specified.');
    return;
  }

  const server = requireServer(repl);
  if (!server) return;
  const trimmed = raw.trim();
  if (trimmed === '-') {
    repl.error('cd - is not supported yet. use an absolute path such as `/projects`.');
    return;
  }
  const target = resolveVirtualPath(shell.cwd, trimmed === '' ? '~' : trimmed);
  if (target === null) {
    repl.error(`'${trimmed}' is outside the shell root (${REMOTE_ROOT}).`);
    return;
  }
  try {
    const result = await sshExec(server, `${cdRoot(target)} && echo yes`);
    if (result.stdout.trim() !== 'yes') {
      repl.error(`no such directory: '${trimmed || '~'}'.`);
      return;
    }
  } catch (err) {
    repl.error(`cannot change directory: ${(err as Error).message}`);
    return;
  }
  repl.state.shell = { mode: 'terminal', cwd: target };
}
