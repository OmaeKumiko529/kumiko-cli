import { loadProjectConfig, saveProjectConfig } from '../config.js';
import { branchDisplay, branchPathFor, branchRef, normalizeBranchPath, requireProject, resolveServer } from '../context.js';
import {
  gitBranchExists,
  gitCreateBranch,
  gitCurrentBranch,
  gitFetch,
  gitFetchLocalBranch,
  gitMergeFfOnly,
  gitPush,
} from '../git.js';
import {
  ensureRemoteRepo,
  pushUrlFor,
  remoteHome,
  remoteWorktreeBranch,
  remoteWorktreeState,
  serverMergeBranch,
  sshCommandFor,
} from '../remote.js';
import type { CommandContext, CommandDefinition } from './registry.js';

function splitPath(value: string): string[] {
  return value.split('/').filter((part) => part.length > 0);
}

function displayOf(segments: string[]): string {
  return segments.join('/');
}

function last(segments: string[]): string {
  return segments[segments.length - 1] as string;
}

async function branchNew(ctx: CommandContext, args: string[]): Promise<void> {
  const rawArg = args[0];
  if (!rawArg) {
    ctx.repl.error('usage: branch new /<parent>/<child>   (e.g. branch new /main/dev)');
    return;
  }
  const segments = splitPath(normalizeBranchPath(rawArg));
  if (segments.length < 2) {
    ctx.repl.error('a child branch path needs a parent: /main/dev');
    return;
  }
  const childRef = last(segments);
  const parentSegments = segments.slice(0, -1);
  const parentRef = last(parentSegments);
  const parentDisplay = displayOf(parentSegments);

  const server = resolveServer(ctx);
  const project = requireProject(ctx);
  const config = loadProjectConfig(project.path);
  if (!config) {
    ctx.repl.error(`no .kumiko.toml in '${project.name}'. run \`sync\` once to create it.`);
    return;
  }

  const currentRef = gitCurrentBranch(project.path);
  const currentDisplay = project.branch ?? (currentRef ? branchPathFor(config, currentRef) : undefined);
  if (!currentDisplay || branchRef(currentDisplay) !== parentRef) {
    ctx.repl.error(`create child branches from their parent: switch to ${branchDisplay(parentDisplay)} first.`);
    return;
  }
  if (config.branches?.[childRef]) {
    ctx.repl.error(`branch '${childRef}' is already in the branch tree as ${branchDisplay(branchPathFor(config, childRef))}.`);
    return;
  }
  if (gitBranchExists(project.path, childRef)) {
    ctx.repl.error(`local branch '${childRef}' already exists.`);
    return;
  }

  gitCreateBranch(project.path, childRef);
  await ensureRemoteRepo(server.entry, project.name);
  const home = await remoteHome(server.entry);
  gitPush(project.path, {
    url: pushUrlFor(server.entry, home, project.name),
    branch: childRef,
    sshCommand: sshCommandFor(server.entry),
  });
  saveProjectConfig(project.path, {
    ...config,
    branches: { ...(config.branches ?? {}), [childRef]: parentRef },
  });

  ctx.repl.setCommandPrefix('KUMIKOCLI');
  ctx.repl.say(`Done! New branch ${branchDisplay(displayOf(segments))}`);
}

async function branchMerge(ctx: CommandContext, args: string[]): Promise<void> {
  if (args.length < 3 || args[1] !== 'to') {
    ctx.repl.error('usage: branch merge <child> to <parent>   (e.g. branch merge /main/dev to /main)');
    return;
  }
  const childSegments = splitPath(normalizeBranchPath(args[0] as string));
  const parentSegments = splitPath(normalizeBranchPath(args[2] as string));
  if (childSegments.length < 2 || parentSegments.length < 1) {
    ctx.repl.error('usage: branch merge /<parent>/<child> to /<parent>');
    return;
  }
  const childRef = last(childSegments);
  const parentRef = last(parentSegments);
  const childDisplay = displayOf(childSegments);
  const parentDisplay = displayOf(parentSegments);

  const server = resolveServer(ctx);
  const project = requireProject(ctx);
  const config = loadProjectConfig(project.path);
  if (!config) {
    ctx.repl.error(`no .kumiko.toml in '${project.name}'. run \`sync\` once to create it.`);
    return;
  }
  if (config.branches?.[childRef] !== parentRef) {
    ctx.repl.error(`${branchDisplay(childDisplay)} is not a direct child of ${branchDisplay(parentDisplay)}.`);
    return;
  }
  const knownChild = branchPathFor(config, childRef);
  const knownParent = branchPathFor(config, parentRef);
  if (knownChild !== childDisplay || knownParent !== parentDisplay) {
    ctx.repl.error(
      `unknown branch path: ${branchDisplay(childDisplay)} is known as ${branchDisplay(knownChild)}, its parent as ${branchDisplay(knownParent)}.`,
    );
    return;
  }

  const remoteState = await remoteWorktreeState(server.entry, project.name);
  if (remoteState === 'absent') {
    ctx.repl.error(`no remote workspace for '${project.name}'. run \`sync\` first.`);
    return;
  }
  const restoreRef = (await remoteWorktreeBranch(server.entry, project.name)) ?? branchRef(project.branch ?? childRef);
  const result = await serverMergeBranch(server.entry, project.name, childRef, parentRef, restoreRef);
  if (result.kind === 'dirty') {
    ctx.repl.error('the remote workspace has uncommitted changes. sync or clean it on the server first.');
    return;
  }
  if (result.kind === 'conflict') {
    ctx.repl.error(`cannot merge ${branchDisplay(childDisplay)} into ${branchDisplay(parentDisplay)}: conflicts in ${result.files.join(', ')}.`);
    return;
  }
  if (result.kind === 'error') {
    ctx.repl.error(`merge failed: ${result.message}`);
    return;
  }

  const home = await remoteHome(server.entry);
  const url = pushUrlFor(server.entry, home, project.name);
  const sshCommand = sshCommandFor(server.entry);
  try {
    if (gitCurrentBranch(project.path) === parentRef) {
      const sha = gitFetch(project.path, { url, branch: parentRef, sshCommand });
      gitMergeFfOnly(project.path, sha);
    } else {
      gitFetchLocalBranch(project.path, { url, branch: parentRef, sshCommand });
    }
  } catch (err) {
    ctx.repl.say(`note: local ${branchDisplay(parentDisplay)} was not updated (${(err as Error).message}); pull it later.`);
  }

  ctx.repl.setCommandPrefix('BRANCH');
  ctx.repl.say(`Done! ${branchDisplay(childDisplay)} merged with ${branchDisplay(parentDisplay)}.`);
}

export const branchCommand: CommandDefinition = {
  name: 'branch',
  usage: 'branch new /<parent>/<child> | branch merge <child> to <parent>',
  summary: 'create a child branch or merge it into its parent',
  promptPrefix: 'KUMIKOCLI',
  async run(ctx: CommandContext): Promise<void> {
    const [subcommand, ...rest] = ctx.args;
    if (subcommand === 'new') return branchNew(ctx, rest);
    if (subcommand === 'merge') return branchMerge(ctx, rest);
    throw new Error('usage: branch new /<parent>/<child> | branch merge <child> to <parent>');
  },
};
