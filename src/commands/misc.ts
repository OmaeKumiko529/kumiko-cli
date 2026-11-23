import { loadProjectConfig } from '../config.js';
import { gitDirtyCount } from '../git.js';
import { displayCwd, shellState } from '../shell.js';
import { sshExec } from '../ssh.js';
import { VERSION } from '../version.js';
import { activeRunSummary, stopActiveRun } from './run.js';
import type { CommandContext, CommandDefinition } from './registry.js';

export const statusCommand: CommandDefinition = {
  name: 'status',
  usage: 'status',
  summary: 'show current context and state',
  promptPrefix: 'STATUS',
  async run(ctx: CommandContext): Promise<void> {
    const state = ctx.repl.state;
    const lines: string[] = [];
    lines.push(
      state.server
        ? `server   ${state.server.name}  ${state.server.entry.user}@${state.server.entry.host}`
        : 'server   (not connected)',
    );
    const shell = shellState(state);
    lines.push(`shell    ${shell.mode}  ${displayCwd(shell.cwd)}`);
    if (!state.project) {
      lines.push('project  (none)');
      ctx.repl.sayLines(lines);
      return;
    }
    const project = state.project;
    lines.push(`project  ${project.name}${project.configuredOnServer ? '' : '  (* local only)'}`);
    lines.push(`path     ${project.path}`);
    lines.push(`branch   ${project.branch ?? '(unknown)'}`);
    const dirty = gitDirtyCount(project.path);
    lines.push(
      `git      ${dirty === undefined ? 'not a git repository' : dirty === 0 ? 'clean' : `${dirty} changed file(s)`}`,
    );
    const projectConfig = loadProjectConfig(project.path);
    lines.push(
      projectConfig
        ? `toml     present  solution=${projectConfig.solution?.name ?? '-'}  run=${projectConfig.run?.command ?? '-'}  build=${projectConfig.build?.command ?? '-'}`
        : 'toml     missing (.kumiko.toml)',
    );
    if (state.server) {
      try {
        const result = await sshExec(
          state.server.entry,
          `test -d "$HOME/kumiko/projects/${project.name}" && echo yes || echo no`,
        );
        lines.push(`remote   ${result.stdout.trim() === 'yes' ? 'project present' : 'not created yet'}`);
      } catch {
        lines.push('remote   unreachable');
      }
    }
    const runSummary = activeRunSummary();
    if (runSummary) lines.push(`run      active  ${runSummary}`);
    ctx.repl.sayLines(lines);
  },
};

export const versionCommand: CommandDefinition = {
  name: 'version',
  usage: 'version',
  summary: 'print the kumiko version',
  promptPrefix: 'KUMIKOCLI',
  async run(ctx: CommandContext): Promise<void> {
    ctx.repl.say(`kumiko ${VERSION}`);
  },
};

export const helpCommand: CommandDefinition = {
  name: 'help',
  usage: 'help',
  summary: 'show available commands',
  promptPrefix: 'KUMIKOCLI',
  async run(ctx: CommandContext): Promise<void> {
    ctx.repl.sayLines([
      'commands:',
      '  server create | list | test | remove <name>   manage servers',
      '  server key <name> [identity]                  attach an ssh key to an existing server',
      '  connect <server>                              connect to a server',
      '  switch <project>[:branch]                     switch project workspace',
      '  switch /                                      clear the workspace, back to the shell root',
      '  switch current -terminal|-kumiko               detach/attach the shell from the current workspace',
      '  sync [commit] [-server <name>] [--force]      commit and push to the server',
      '  build [-server <name>] [-artifacts]           build on the server (pull dist with -artifacts)',
      '  pull [branch] [-server <name>] [--force]      pull server-side changes back home',
      '  run [-server <name>] [--port <local>]         run on the server, forward the dev port',
      '  run stop                                      stop the active run session',
      '  branch new /<parent>/<child>                  create a child branch (e.g. branch new /main/dev)',
      '  branch merge <child> to <parent>              merge a child branch into its parent',
      '  setting [<name> on|off]                       show or change project settings',
      '  commond [status|log|diff|add|commit|push]     common git commands through the native shell',
      '  logs [check <sha>]                            sync history / changed files',
      '  status                                        current context and state',
      '  version                                       print the kumiko version',
      '  help                                          this list',
      '  exit                                          quit',
      '',
      'shell:',
      '  anything else runs on the server from the shell cwd (ls, git, npm, ...).',
      '  `cd <path>` moves the shell; it is pinned while a workspace+branch is selected.',
    ]);
  },
};

export const exitCommand: CommandDefinition = {
  name: 'exit',
  usage: 'exit',
  summary: 'quit kumiko',
  promptPrefix: 'KUMIKOCLI',
  async run(ctx: CommandContext): Promise<void> {
    await stopActiveRun(ctx.repl, true);
    ctx.repl.quit();
  },
};
