import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadProjectConfig } from '../config.js';
import { branchDisplay, branchPathFor, branchRef } from '../context.js';
import { gitBranchExists, gitCheckout, gitCurrentBranch, gitDirtyCount } from '../git.js';
import { sshExec } from '../ssh.js';
import type { CommandContext, CommandDefinition } from './registry.js';

function splitProjectArg(raw: string): { project: string; branch?: string } {
  // Windows absolute path: C:\... or C:/... — the drive colon is not the
  // project:branch separator, so look for the next colon after it.
  const start = /^[A-Za-z]:[\\/]/.test(raw) ? 2 : 0;
  const index = raw.indexOf(':', start);
  if (index <= 0) return { project: raw };
  const branch = raw.slice(index + 1).replace(/^\/+/, '') || undefined;
  return { project: raw.slice(0, index), branch };
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
  usage: 'switch <project>[:branch] [--carry]',
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
      ctx.repl.error('usage: switch <project>[:branch] [--carry]');
      return;
    }
    const { project, branch: branchArg } = splitProjectArg(raw);
    const target = path.resolve(process.cwd(), project);
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      ctx.repl.error(`project '${project}' not found at ${target}`);
      return;
    }
    const projectConfig = loadProjectConfig(target);
    const name = projectConfig?.project.name ?? path.basename(target);

    let displayPath: string;
    if (branchArg) {
      const requested = branchArg.split('/').filter(Boolean).join('/');
      const ref = branchRef(requested);
      if (!gitBranchExists(target, ref)) {
        ctx.repl.error(`local branch '${ref}' does not exist in ${target}. create it with \`branch new <path>\`.`);
        return;
      }
      const fromConfig = projectConfig ? branchPathFor(projectConfig, ref) : requested;
      if (projectConfig && requested.includes('/') && fromConfig !== requested) {
        ctx.repl.error(`'${requested}' is not a known branch path; use ${branchDisplay(fromConfig)}.`);
        return;
      }
      displayPath = projectConfig ? fromConfig : requested;
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
  },
};
