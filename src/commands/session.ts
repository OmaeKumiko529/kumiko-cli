import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadKnownProjects, loadProjectConfig, rememberProject } from '../config.js';
import { branchDisplay, branchPathFor, branchRef, normalizeBranchPath } from '../context.js';
import { gitBranchExists, gitCheckout, gitCurrentBranch, gitDirtyCount } from '../git.js';
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
 *   switch :<branch>                     (branch of the current project)
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
  if (!projectConfig) return [];
  const paths = new Set<string>();
  const current = gitCurrentBranch(dir);
  if (current) paths.add(branchPathFor(projectConfig, current));
  for (const child of Object.keys(projectConfig.branches ?? {})) {
    paths.add(branchPathFor(projectConfig, child));
  }
  return [...paths].map(branchDisplay);
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
  usage: 'switch <project|path>[:branch] [--carry]',
  summary: 'switch the current project workspace',
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
      ctx.repl.error('usage: switch <project|path>[:branch] [--carry]');
      return;
    }

    const { project: rawProject, branch: rawBranch } = splitProjectArg(raw);
    const normalizedBranch = rawBranch === undefined ? undefined : normalizeBranchPath(rawBranch);
    const branchArg = normalizedBranch && normalizedBranch.length > 0 ? normalizedBranch : undefined;

    const target = resolveProjectTarget(rawProject, ctx.repl.state.project);
    if (!target) {
      if (!rawProject) {
        ctx.repl.error('no project is selected. usage: switch <project|path>[:branch] [--carry]');
        return;
      }
      const known = Object.keys(loadKnownProjects());
      const hint = known.length > 0 ? ` (known projects: ${known.join(', ')})` : '';
      ctx.repl.error(`project '${rawProject}' not found${hint}. pass a project path or a name you used before.`);
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
        const dirty = gitDirtyCount(target) ?? 0;
        if (dirty > 0 && !carry) {
          ctx.repl.error('the workspace has uncommitted changes. re-run with --carry to take them to the branch.');
          return;
        }
        gitCheckout(target, ref);
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
