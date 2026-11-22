import type { CommandContext } from './commands/registry.js';
import type { LocalProject, ServerEntry } from './types.js';

export interface SelectedServer {
  name: string;
  entry: ServerEntry;
}

export function resolveServer(ctx: CommandContext, serverName?: string): SelectedServer {
  if (serverName) {
    const entry = ctx.config.servers[serverName];
    if (!entry) throw new Error(`server '${serverName}' not found. use \`server list\`.`);
    return { name: serverName, entry };
  }
  if (!ctx.repl.state.server) {
    throw new Error('no server selected. use `connect <server>` or pass -server <name>.');
  }
  return ctx.repl.state.server;
}

export function requireProject(ctx: CommandContext): LocalProject {
  const project = ctx.repl.state.project;
  if (!project) throw new Error('no project selected. use `switch <project>[:branch]` first.');
  return project;
}

export function branchDisplay(branch: string): string {
  return `/${branch}`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
