import type { CommandContext } from './commands/registry.js';
import type { LocalProject, ProjectConfig, ServerEntry } from './types.js';

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

/** Normalize a user typed branch path: `\main\dev` / `/main/dev/` -> `main/dev`. */
export function normalizeBranchPath(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0)
    .join('/');
}

/** The git ref behind a display path: `main/dev` -> `dev`. */
export function branchRef(branchPath: string): string {
  const parts = branchPath.split('/').filter((part) => part.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : branchPath;
}

/** Walk the `[branches]` parent map: `dev` -> `main/dev`. */
export function branchPathFor(config: ProjectConfig | null, ref: string): string {
  if (!config?.branches) return ref;
  const segments = [ref];
  let current = ref;
  for (let guard = 0; guard < 20; guard += 1) {
    const parent = config.branches[current];
    if (!parent) break;
    segments.unshift(parent);
    current = parent;
  }
  return segments.join('/');
}

/** Direct child branches of a ref, from the `[branches]` map. */
export function childBranches(config: ProjectConfig | null, ref: string): string[] {
  if (!config?.branches) return [];
  return Object.entries(config.branches)
    .filter(([, parent]) => parent === ref)
    .map(([child]) => child);
}

export function syncChildrenEnabled(config: ProjectConfig | null): boolean {
  return config?.branch?.syncChildren !== false;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
