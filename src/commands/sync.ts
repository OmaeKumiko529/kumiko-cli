import {
  appendHistory,
  listSolutions,
  loadHistory,
  loadProjectConfig,
  loadSolution,
  saveProjectConfig,
} from '../config.js';
import { confirmForce } from '../confirm.js';
import {
  gitAddAllAndCommit,
  gitCurrentBranch,
  gitDirtyCount,
  gitHeadSha,
  gitInitMain,
  gitPush,
  gitShowCommitFiles,
  isGitRepo,
} from '../git.js';
import {
  ensureRemoteRepo,
  ensureRemoteWorktree,
  pushUrlFor,
  remoteHome,
  remoteWorktreeState,
  sshCommandFor,
  updateRemoteWorktree,
  validateProjectName,
} from '../remote.js';
import type { ServerEntry, SyncRecord } from '../types.js';
import type { CommandContext, CommandDefinition } from './registry.js';

interface SyncOptions {
  message?: string;
  force: boolean;
  serverName?: string;
}

interface SelectedServer {
  name: string;
  entry: ServerEntry;
}

function parseSyncArgs(args: string[]): SyncOptions {
  const options: SyncOptions = { force: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '-server' || arg === '--server' || arg === '-s') {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} needs a server name`);
      options.serverName = value;
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown sync option '${arg}'`);
    } else if (options.message) {
      throw new Error(`unexpected argument '${arg}'`);
    } else {
      options.message = arg;
    }
  }
  return options;
}

function resolveServer(ctx: CommandContext, serverName?: string): SelectedServer {
  if (serverName) {
    const entry = ctx.config.servers[serverName];
    if (!entry) throw new Error(`server '${serverName}' not found. use \`server list\`.`);
    return { name: serverName, entry };
  }
  if (!ctx.repl.state.server) {
    throw new Error('no server selected. use `connect <server>` or `sync -server <name>`.');
  }
  return ctx.repl.state.server;
}

function branchDisplay(branch: string): string {
  return `/${branch}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

async function createFlow(ctx: CommandContext, server: SelectedServer): Promise<void> {
  const repl = ctx.repl;
  const project = repl.state.project;
  if (!project) return;
  const name = project.name;

  repl.say(`Unconfigured project '${name}'.`);
  repl.say('');

  let solutionName = '';
  let runCommand: string | undefined;
  let buildCommand: string | undefined;
  for (;;) {
    const mode = (await repl.ask('Load a configured solution or create a new solution[l/c] ')).trim().toLowerCase();
    if (mode === 'c') {
      solutionName = (await repl.ask('solutionName: ')).trim() || 'Default';
      runCommand = (await repl.ask('Configure `kumiko run`: ')).trim() || undefined;
      buildCommand = (await repl.ask('Configure `kumiko build`: ')).trim() || undefined;
      repl.say(`Done! You can modify additional configuration options in *kumikocli/sol/${solutionName.toLowerCase()}.sol`);
      break;
    }
    if (mode === 'l') {
      const solutions = listSolutions();
      if (solutions.length === 0) {
        repl.say('no installed solution found in ~/.kumiko/sol/. use [c] to create one.');
        continue;
      }
      repl.sayLines(['installed solutions:', ...solutions.map((item) => `  * ${item}`)]);
      solutionName = (await repl.ask('solutionName: ')).trim();
      const solution = loadSolution(solutionName);
      if (!solution) {
        repl.say(`solution '${solutionName}' not found.`);
        continue;
      }
      runCommand = solution.run?.command;
      buildCommand = solution.build?.command;
      break;
    }
  }

  saveProjectConfig(project.path, {
    project: { name },
    solution: solutionName ? { name: solutionName } : undefined,
    run: runCommand ? { command: runCommand } : undefined,
    build: buildCommand ? { command: buildCommand } : undefined,
  });
  repl.say(`Write .kumiko.toml at *${name}/`);

  let branch = gitCurrentBranch(project.path);
  if (!branch) {
    if (!isGitRepo(project.path)) {
      repl.say(`No Git configuration. Create repository as '${name}'.`);
      gitInitMain(project.path);
    }
    const initialize = (await repl.ask('Initialize a main branch? [y/n] ')).trim().toLowerCase();
    if (initialize !== 'y') {
      repl.say('sync cancelled: an initial commit is required.');
      return;
    }
    branch = 'main';
  }

  const dirty = gitDirtyCount(project.path) ?? 0;
  if (dirty === 0) {
    repl.say('nothing to commit.');
    return;
  }
  const sha = gitAddAllAndCommit(project.path, 'Initial commit');
  const files = gitShowCommitFiles(project.path, sha).length;
  await ensureRemoteRepo(server.entry, name);
  const home = await remoteHome(server.entry);
  gitPush(project.path, { url: pushUrlFor(server.entry, home, name), branch, sshCommand: sshCommandFor(server.entry) });
  await ensureRemoteWorktree(server.entry, name);
  await updateRemoteWorktree(server.entry, name, branch);

  const record: SyncRecord = { message: 'Initial commit', sha, branch, time: new Date().toISOString(), files };
  appendHistory(name, record);
  project.configuredOnServer = true;
  project.branch = branch;
  repl.setCommandPrefix('KUMIKOCLI');
  repl.say(`Done! Sync as 'Initial commit':${sha.slice(0, 8)}.`);
}

async function syncFlow(ctx: CommandContext, server: SelectedServer, options: SyncOptions): Promise<void> {
  const repl = ctx.repl;
  const project = repl.state.project;
  if (!project) return;
  const name = project.name;
  validateProjectName(name);

  if (!loadProjectConfig(project.path)) {
    await createFlow(ctx, server);
    return;
  }

  if (!isGitRepo(project.path)) {
    repl.error(`project '${name}' is not a git repository.`);
    return;
  }

  const branch = project.branch ?? gitCurrentBranch(project.path) ?? 'main';
  const dirty = gitDirtyCount(project.path) ?? 0;
  if (dirty === 0 && !options.force) {
    repl.say('nothing to sync: working tree is clean.');
    return;
  }

  const history = loadHistory(name);
  const liveCount = history.filter((record) => /^live\d+$/.test(record.message)).length;
  const message = options.message ?? `live${liveCount + 1}`;
  const sha = dirty > 0 ? gitAddAllAndCommit(project.path, message) : (gitHeadSha(project.path) as string);
  const files = gitShowCommitFiles(project.path, sha).length;

  await ensureRemoteRepo(server.entry, name);
  const home = await remoteHome(server.entry);
  const state = await remoteWorktreeState(server.entry, name);
  if (state === 'dirty' && !options.force) {
    repl.error('the remote workspace has uncommitted changes. re-run with --force to overwrite.');
    return;
  }
  if (options.force) {
    const confirmed = await confirmForce(repl, 'push', branch);
    if (!confirmed) {
      repl.say('cancelled.');
      return;
    }
  }

  gitPush(project.path, {
    url: pushUrlFor(server.entry, home, name),
    branch,
    force: options.force,
    sshCommand: sshCommandFor(server.entry),
  });
  await ensureRemoteWorktree(server.entry, name);
  await updateRemoteWorktree(server.entry, name, branch);

  const record: SyncRecord = { message, sha, branch, time: new Date().toISOString(), files };
  appendHistory(name, record);
  project.configuredOnServer = true;
  project.branch = branch;
  repl.say(
    `Done! Push ${plural(files, 'changed file')} to ${name}:${branchDisplay(branch)} as '${message}':${sha.slice(0, 8)}.`,
  );
}

export const syncCommand: CommandDefinition = {
  name: 'sync',
  usage: 'sync [commit] [-server <name>] [--force]',
  summary: 'commit and push the current project to the server',
  promptPrefix: 'SYNC',
  async run(ctx: CommandContext): Promise<void> {
    const options = parseSyncArgs(ctx.args);
    const server = resolveServer(ctx, options.serverName);
    if (!ctx.repl.state.project) {
      ctx.repl.error('no project selected. use `switch <project>[:branch]` first.');
      return;
    }
    if (!loadProjectConfig(ctx.repl.state.project.path)) {
      await createFlow(ctx, server);
      return;
    }
    await syncFlow(ctx, server, options);
  },
};
