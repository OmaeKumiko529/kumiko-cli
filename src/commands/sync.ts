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
  branchDisplay,
  branchPathFor,
  branchRef,
  childBranches,
  plural,
  resolveServer,
  syncChildrenEnabled,
  type SelectedServer,
} from '../context.js';
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
  serverPropagateChildren,
  sshCommandFor,
  updateRemoteWorktree,
  validateProjectName,
} from '../remote.js';
import type { ProjectConfig, SyncRecord } from '../types.js';
import { noticeBadge, successBadge } from '../ui.js';
import type { CommandContext, CommandDefinition } from './registry.js';

/** Shown when syncing a parent branch that has children. */
const SYNC_CHILDREN_NOTICE =
  'By default running sync on a parent branch will cause the same sync content to be pushed to its child branches. To change this setting, use the kumiko setting.';

interface SyncOptions {
  message?: string;
  force: boolean;
  serverName?: string;
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

function displayPathFor(config: ProjectConfig | null, ref: string): string {
  return config ? branchPathFor(config, ref) : ref;
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
      repl.say(`${successBadge()} You can modify additional configuration options in *kumikocli/sol/${solutionName.toLowerCase()}.sol`);
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
  const displayPath = displayPathFor(loadProjectConfig(project.path), branch);
  const sha = gitAddAllAndCommit(project.path, 'Initial commit');
  const files = gitShowCommitFiles(project.path, sha).length;
  await ensureRemoteRepo(server.entry, name);
  const home = await remoteHome(server.entry);
  gitPush(project.path, {
    url: pushUrlFor(server.entry, home, name),
    branch: branchRef(displayPath),
    sshCommand: sshCommandFor(server.entry),
  });
  await ensureRemoteWorktree(server.entry, name);
  await updateRemoteWorktree(server.entry, name, branchRef(displayPath));

  const record: SyncRecord = { message: 'Initial commit', sha, branch: displayPath, time: new Date().toISOString(), files };
  appendHistory(name, record);
  project.configuredOnServer = true;
  project.branch = displayPath;
  repl.setCommandPrefix('KUMIKOCLI');
  repl.say(`${successBadge()} Sync as 'Initial commit':${sha.slice(0, 8)}.`);
}

async function syncFlow(ctx: CommandContext, server: SelectedServer, options: SyncOptions): Promise<void> {
  const repl = ctx.repl;
  const project = repl.state.project;
  if (!project) return;
  const name = project.name;
  validateProjectName(name);

  const projectConfig = loadProjectConfig(project.path);
  if (!projectConfig) {
    await createFlow(ctx, server);
    return;
  }

  if (!isGitRepo(project.path)) {
    repl.error(`project '${name}' is not a git repository.`);
    return;
  }

  const displayPath = project.branch ?? displayPathFor(projectConfig, gitCurrentBranch(project.path) ?? 'main');
  const ref = branchRef(displayPath);
  const children = childBranches(projectConfig, ref);
  const propagate = children.length > 0 && syncChildrenEnabled(projectConfig);
  if (propagate) {
    repl.say(`${noticeBadge()} ${SYNC_CHILDREN_NOTICE}`);
    const answer = (await repl.ask('Input branch name to sync: ')).trim();
    if (answer !== ref) {
      repl.say('cancelled.');
      return;
    }
  }

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
    const confirmed = await confirmForce(repl, 'push', ref);
    if (!confirmed) {
      repl.say('cancelled.');
      return;
    }
  }

  gitPush(project.path, {
    url: pushUrlFor(server.entry, home, name),
    branch: ref,
    force: options.force,
    sshCommand: sshCommandFor(server.entry),
  });
  await ensureRemoteWorktree(server.entry, name);
  await updateRemoteWorktree(server.entry, name, ref);

  const record: SyncRecord = { message, sha, branch: displayPath, time: new Date().toISOString(), files };
  appendHistory(name, record);
  project.configuredOnServer = true;
  project.branch = displayPath;

  if (propagate) {
    const result = await serverPropagateChildren(server.entry, name, ref, children, ref);
    if (result.kind === 'conflict') {
      repl.error(
        `pushed to ${name}:${branchDisplay(displayPath)} but merging into ${displayPathFor(projectConfig, result.conflictBranch ?? '')} hit conflicts: ${result.files.join(', ')}. resolve them on the server and re-run \`branch merge\`.`,
      );
      return;
    }
    if (result.kind === 'error') {
      repl.error(`pushed to ${name}:${branchDisplay(displayPath)} but the child branches were not updated: ${result.message}`);
      return;
    }
  }

  repl.say(
    `${successBadge()} Push ${plural(files, 'changed file')} to ${name}:${branchDisplay(displayPath)}${propagate ? ' and its child branches' : ''} as '${message}':${sha.slice(0, 8)}.`,
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
    await syncFlow(ctx, server, options);
  },
};
