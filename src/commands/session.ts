import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadKnownProjects, loadProjectConfig, rememberProject } from '../config.js';
import { branchDisplay, branchPathFor, branchRef, normalizeBranchPath } from '../context.js';
import { gitBranchExists, gitCheckout, gitCurrentBranch, gitDirtyFiles } from '../git.js';
import { sshExec } from '../ssh.js';
import type { LocalProject, ProjectConfig } from '../types.js';
import type { CommandContext, CommandDefinition } from './registry.js';

function splitProjectArg(raw: string): { project: string; branch?: string } {
  // Windows absolute path: C:\... or C:/... — the drive colon is not the
  // project:branch separator, so look for the next colon after it.
  const start = /^[A-Za-z]:[\\/]/.test(raw) ? 2 : 0;
  const index = raw.indexOf(':', start);
  if (index < 0) return { project: raw };
  // `:/main/dev` means "the current project, that branch".
  if (index === 0) return { project: '', branch: raw.slice(1) };
  return { project: raw.slice(0, index), branch: raw.slice(index + 1) };
}

function isDirectory(target: string): boolean {
  return existsSync(target) && statSync(target).isDirectory();
}

/**
 * Resolve the `switch` project argument. Accepted forms:
 *   switch <absolute-or-relative-path>[:branch]
 *   switch <project name>[:branch]       (a name switched to before, or the current project)
 */
function resolveProjectTarget(rawProject: string, current: LocalProject | undefined): string | null {
  if (!rawProject) return current ? current.path : null;
  const fromCwd = path.resolve(process.cwd(), rawProject);
  if (isDirectory(fromCwd)) return fromCwd;
  // Sibling of the directory kumiko was launched from (e.g. launched in one repo, switching to another).
  const fromCwdParent = path.resolve(path.dirname(process.cwd()), rawProject);
  if (isDirectory(fromCwdParent)) return fromCwdParent;
  if (current) {
    if (rawProject === current.name || rawProject === path.basename(current.path)) return current.path;
    // `switch OtherProject` while inside a project usually means a sibling directory.
    const fromParent = path.resolve(path.dirname(current.path), rawProject);
    if (isDirectory(fromParent)) return fromParent;
  }
  const knownDir = loadKnownProjects()[rawProject];
  if (knownDir && isDirectory(knownDir)) return knownDir;
  return null;
}

/** Display paths of branches this project knows about, for better error hints. */
function knownBranchPaths(projectConfig: ProjectConfig | null, dir: string): string[] {
  if (!projectConfig) {
    const current = gitCurrentBranch(dir);
    return current ? [branchDisplay(current)] : [];
  }
  const paths = new Set<string>();
  const current = gitCurrentBranch(dir);
  if (current) paths.add(branchPathFor(projectConfig, current));
  for (const child of Object.keys(projectConfig.branches ?? {})) {
    paths.add(branchPathFor(projectConfig, child));
  }
  return [...paths].map(branchDisplay);
}

/** Cheap "did you mean" for project names: Levenshtein distance of at most 2. */
function suggestName(input: string, candidates: string[]): string | undefined {
  const distance = (a: string, b: string): number => {
    const rows: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = rows[0] as number;
      rows[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const saved = rows[j] as number;
        rows[j] = Math.min(
          (rows[j] as number) + 1,
          (rows[j - 1] as number) + 1,
          previous + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        previous = saved;
      }
    }
    return rows[b.length] as number;
  };
  const lower = input.toLowerCase();
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = distance(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** A branch path that exists locally, if any: `/main/test`, `main/test` or `test`. */
function resolveBranchInProject(dir: string, projectConfig: ProjectConfig | null, branchPath: string): string | null {
  const normalized = normalizeBranchPath(branchPath);
  if (!normalized) return null;
  const ref = branchRef(normalized);
  if (!gitBranchExists(dir, ref)) return null;
  const displayPath = projectConfig ? branchPathFor(projectConfig, ref) : normalized;
  if (normalized.includes('/') && displayPath !== normalized) return null;
  return displayPath;
}

async function remoteProjectExists(entry: Parameters<typeof sshExec>[0], projectName: string): Promise<boolean> {
  try {
    const result = await sshExec(entry, `test -d "$HOME/kumiko/projects/${projectName}" && echo yes || echo no`);
    return result.stdout.trim() === 'yes';
  } catch {
    return false;
  }
}

export const connectCommand: CommandDefinition = {
  name: 'connect',
  usage: 'connect <server>',
  summary: 'connect to a configured server',
  promptPrefix: 'KUMIKOCLI',
  async run(ctx: CommandContext): Promise<void> {
    const name = ctx.args[0];
    if (!name) {
      ctx.repl.error('usage: connect <server>');
      return;
    }
    const entry = ctx.config.servers[name];
    if (!entry) {
      ctx.repl.error(`server '${name}' not found. use \`server list\`.`);
      return;
    }
    ctx.repl.state.server = { name, entry };
  },
};

export const switchCommand: CommandDefinition = {
  name: 'switch',
  usage: 'switch <project|path|branch>[:branch] [--carry]',
  summary: 'switch the current project workspace or branch',
  promptPrefix: 'KUMIKOCLI',
  async run(ctx: CommandContext): Promise<void> {
    const positional: string[] = [];
    let carry = false;
    for (const arg of ctx.args) {
      if (arg === '--carry') carry = true;
      else if (arg.startsWith('-')) throw new Error(`unknown switch option '${arg}'`);
      else positional.push(arg);
    }
    const raw = positional[0];
    if (!raw) {
      ctx.repl.error('usage: switch <project|path|branch>[:branch] [--carry]');
      return;
    }

    const current = ctx.repl.state.project;
    const branchOnly = /^[:/\\]/.test(raw);
    const parsed = branchOnly ? { project: '', branch: raw.replace(/^[:/\\]+/, '') } : splitProjectArg(raw);
    const normalizedBranch = parsed.branch === undefined ? undefined : normalizeBranchPath(parsed.branch);
    let branchArg = normalizedBranch && normalizedBranch.length > 0 ? normalizedBranch : undefined;

    // Resolve the project. A bare word (`switch test`) prefers a local branch of
    // the current project, then a known project name, then a path.
    const isBareWord =
      !branchOnly &&
      parsed.project !== '' &&
      !/[\\/]/.test(parsed.project) &&
      parsed.project !== '.' &&
      parsed.project !== '..';
    let target: string | null = null;
    if (branchOnly) {
      target = current ? current.path : null;
    } else if (isBareWord) {
      if (current) {
        const displayPath = resolveBranchInProject(current.path, loadProjectConfig(current.path), parsed.project);
        if (displayPath && !branchArg) {
          target = current.path;
          branchArg = displayPath;
        }
        if (!target && (parsed.project === current.name || parsed.project === path.basename(current.path))) {
          target = current.path;
        }
      }
      if (!target) {
        const knownDir = loadKnownProjects()[parsed.project];
        if (knownDir && isDirectory(knownDir)) target = knownDir;
      }
    }
    if (!target) target = resolveProjectTarget(parsed.project, current);

    if (!target) {
      if (!parsed.project) {
        ctx.repl.error('no project is selected. usage: switch <project|path|branch> [--carry]');
        return;
      }
      const known = Object.keys(loadKnownProjects());
      const parts = [`project '${parsed.project}' not found.`];
      if (known.length > 0) parts.push(`known projects: ${known.join(', ')}.`);
      if (current) {
        const branches = knownBranchPaths(loadProjectConfig(current.path), current.path);
        if (branches.length > 0) parts.push(`current branches: ${branches.join(', ')}.`);
      }
      const guess = suggestName(parsed.project, [...known, ...(current ? [current.name] : [])]);
      parts.push(
        guess
          ? `did you mean '${guess}'? or pass a project path / branch path.`
          : 'pass a project path, a known project name, or a branch path.',
      );
      ctx.repl.error(parts.join(' '));
      return;
    }

    const projectConfig = loadProjectConfig(target);
    const name = projectConfig?.project.name ?? path.basename(target);

    let displayPath: string;
    if (branchArg) {
      const ref = branchRef(branchArg);
      if (!gitBranchExists(target, ref)) {
        const known = knownBranchPaths(projectConfig, target);
        const hint = known.length > 0 ? ` known branch paths: ${known.join(', ')}.` : '';
        ctx.repl.error(
          `local branch '${ref}' does not exist in ${target}.${hint} create it with \`branch new ${branchDisplay(branchArg)}\`.`,
        );
        return;
      }
      const fromConfig = projectConfig ? branchPathFor(projectConfig, ref) : branchArg;
      if (projectConfig && branchArg.includes('/') && fromConfig !== branchArg) {
        ctx.repl.error(`'${branchArg}' is not a known branch path; use ${branchDisplay(fromConfig)}.`);
        return;
      }
      displayPath = projectConfig ? fromConfig : branchArg;
      const currentRef = gitCurrentBranch(target);
      if (ref !== currentRef) {
        const dirtyFiles = gitDirtyFiles(target) ?? [];
        // .kumiko.toml 是 CLI 维护的项目元数据（例如 branch new 刚写入 [branches]），
        // 它没有丢失风险时不该阻塞切换；被 git 拦下时会走下面的 checkout 错误提示。
        const metadataOnly = dirtyFiles.length > 0 && dirtyFiles.every((file) => file === '.kumiko.toml');
        if (dirtyFiles.length > 0 && !carry && !metadataOnly) {
          ctx.repl.error(
            `the workspace has uncommitted changes. re-run with \`switch ${raw} --carry\` to take them to the branch.`,
          );
          return;
        }
        try {
          gitCheckout(target, ref);
        } catch (err) {
          const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
          const lines = stderr?.split('\n').map((line) => line.trim()).filter((line) => line.length > 0) ?? [];
          const detail = lines.length > 0 ? lines.slice(0, 3).join(' ') : (err as Error).message;
          ctx.repl.error(
            `cannot switch to '${ref}': ${detail}. commit or stash the local changes in ${target} first, then retry.`,
          );
          return;
        }
      }
    } else {
      const ref = gitCurrentBranch(target) ?? 'main';
      displayPath = projectConfig ? branchPathFor(projectConfig, ref) : ref;
    }

    let configuredOnServer = false;
    if (ctx.repl.state.server) {
      const exists = await remoteProjectExists(ctx.repl.state.server.entry, name);
      configuredOnServer = Boolean(projectConfig) && exists;
    }
    ctx.repl.state.project = { name, path: target, branch: displayPath, configuredOnServer };

    rememberProject(name, target);
    const basename = path.basename(target);
    if (basename !== name) rememberProject(basename, target);
  },
};
