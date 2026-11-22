import { loadProjectConfig } from '../config.js';
import { gitDirtyCount } from '../git.js';
import { sshExec } from '../ssh.js';
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
    ctx.repl.sayLines(lines);
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
      '  connect <server>                              connect to a server',
      '  switch <project>[:branch]                     switch project workspace',
      '  sync [commit] [-server <name>] [--force]      commit and push to the server',
      '  build [-server <name>] [-artifacts]           build on the server (pull dist with -artifacts)',
      '  pull [branch] [-server <name>] [--force]      pull server-side changes back home',
      '  branch new /<parent>/<child>                  create a child branch (e.g. branch new /main/dev)',
      '  branch merge <child> to <parent>              merge a child branch into its parent',
      '  setting [<name> on|off]                       show or change project settings',
      '  logs [check <sha>]                            sync history / changed files',
      '  status                                        current context and state',
      '  help                                          this list',
      '  exit                                          quit',
      '',
      'planned (request.md): dev',
    ]);
  },
};

export const exitCommand: CommandDefinition = {
  name: 'exit',
  usage: 'exit',
  summary: 'quit kumiko',
  promptPrefix: 'KUMIKOCLI',
  async run(ctx: CommandContext): Promise<void> {
    ctx.repl.quit();
  },
};
