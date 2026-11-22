import { loadProjectConfig } from '../config.js';
import { confirmForce } from '../confirm.js';
import { branchDisplay, branchPathFor, branchRef, plural, requireProject, resolveServer } from '../context.js';
import {
  gitCurrentBranch,
  gitDiffFileNames,
  gitFetch,
  gitHeadSha,
  gitMergeFfOnly,
  gitResetHard,
  gitTrackedDirtyCount,
} from '../git.js';
import {
  pushUrlFor,
  remoteHome,
  remoteWorktreeBranch,
  remoteWorktreeState,
  serverCommitAndPush,
  sshCommandFor,
} from '../remote.js';
import { successBadge } from '../ui.js';
import type { CommandContext, CommandDefinition } from './registry.js';

interface PullOptions {
  branch?: string;
  force: boolean;
  serverName?: string;
}

function parsePullArgs(args: string[]): PullOptions {
  const options: PullOptions = { force: false };
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
      throw new Error(`unknown pull option '${arg}'`);
    } else if (options.branch) {
      throw new Error(`unexpected argument '${arg}'`);
    } else {
      options.branch = arg;
    }
  }
  return options;
}

/** Accept both the CLI display path (`/main/dev`) and the bare git branch (`dev`). */
function branchNameFromArg(value: string): string {
  return branchRef(value);
}

export const pullCommand: CommandDefinition = {
  name: 'pull',
  usage: 'pull [branch] [-server <name>] [--force]',
  summary: 'pull changes made on the server back into the local project',
  promptPrefix: 'PULL',
  async run(ctx: CommandContext): Promise<void> {
    const options = parsePullArgs(ctx.args);
    const server = resolveServer(ctx, options.serverName);
    const project = requireProject(ctx);

    const projectConfig = loadProjectConfig(project.path);
    if (!projectConfig) {
      ctx.repl.error(`no .kumiko.toml in '${project.name}'. run \`sync\` once to create it.`);
      return;
    }
    const remoteState = await remoteWorktreeState(server.entry, project.name);
    if (remoteState === 'absent') {
      ctx.repl.error(`no remote workspace for '${project.name}'. run \`sync\` first.`);
      return;
    }

    const currentRef = gitCurrentBranch(project.path);
    const localDisplay = project.branch ?? (currentRef ? branchPathFor(projectConfig, currentRef) : 'main');
    const branch = options.branch ? branchNameFromArg(options.branch) : branchRef(localDisplay);
    const displayPath = options.branch ? branchPathFor(projectConfig, branch) : localDisplay;
    if (options.branch && branch !== currentRef) {
      ctx.repl.error(`switch to ${branchDisplay(displayPath)} before pulling it (current branch is '${currentRef ?? 'unknown'}').`);
      return;
    }
    const remoteBranch = await remoteWorktreeBranch(server.entry, project.name);
    if (remoteBranch && remoteBranch !== branch) {
      ctx.repl.error(
        `the server workspace is on '${remoteBranch}', not '${branch}'. switch the server workspace first or use \`pull ${remoteBranch}\`.`,
      );
      return;
    }

    const dirty = gitTrackedDirtyCount(project.path) ?? 0;
    if (dirty > 0 && !options.force) {
      ctx.repl.error('the local workspace has changes. run `sync` to push them, or `pull --force` to overwrite.');
      return;
    }
    if (options.force) {
      const confirmed = await confirmForce(ctx.repl, 'pull', branch);
      if (!confirmed) {
        ctx.repl.say('cancelled.');
        return;
      }
    }

    const home = await remoteHome(server.entry);
    const oldSha = gitHeadSha(project.path);
    const remoteSha = await serverCommitAndPush(server.entry, project.name, branch);
    const fetchedSha = gitFetch(project.path, {
      url: pushUrlFor(server.entry, home, project.name),
      branch,
      sshCommand: sshCommandFor(server.entry),
    });
    if (fetchedSha !== remoteSha) {
      throw new Error('the fetched commit does not match the server commit');
    }

    const files = oldSha ? gitDiffFileNames(project.path, oldSha, fetchedSha) : [];
    if (options.force) {
      gitResetHard(project.path, fetchedSha);
    } else if (oldSha !== fetchedSha) {
      try {
        gitMergeFfOnly(project.path, fetchedSha);
      } catch {
        ctx.repl.error('the local branch has diverged from the server. re-run with --force to overwrite.');
        return;
      }
    }

    project.branch = displayPath;
    project.configuredOnServer = true;
    ctx.repl.say(`${successBadge()} Pull ${plural(files.length, 'file')} from ${project.name}:${branchDisplay(displayPath)}.`);
  },
};
