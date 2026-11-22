import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadProjectConfig } from '../config.js';
import { gitCurrentBranch } from '../git.js';
import { sshExec } from '../ssh.js';
import type { CommandContext, CommandDefinition } from './registry.js';

function splitProjectArg(raw: string): { project: string; branch?: string } {
  // Windows absolute path: C:\... or C:/... must not be treated as project:branch.
  if (/^[A-Za-z]:[\\/]/.test(raw)) return { project: raw };
  const index = raw.indexOf(':');
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
  usage: 'switch <project>[:branch]',
  summary: 'switch the current project workspace',
  promptPrefix: 'KUMIKOCLI',
  async run(ctx: CommandContext): Promise<void> {
    const raw = ctx.args[0];
    if (!raw) {
      ctx.repl.error('usage: switch <project>[:branch]');
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
    const branch = branchArg ?? gitCurrentBranch(target);
    let configuredOnServer = false;
    if (ctx.repl.state.server) {
      const exists = await remoteProjectExists(ctx.repl.state.server.entry, name);
      configuredOnServer = Boolean(projectConfig) && exists;
    }
    ctx.repl.state.project = { name, path: target, branch, configuredOnServer };
  },
};
