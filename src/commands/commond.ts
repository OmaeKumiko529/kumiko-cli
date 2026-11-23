import { shQuote } from '../remote.js';
import { runNativeCommand } from '../shell.js';
import type { CommandContext, CommandDefinition } from './registry.js';

const HELP = [
  'commond: common git commands, run on the connected server like a native command',
  '  commond status              short status with branch information',
  '  commond log                 last 10 commits, one line each',
  '  commond diff                unstaged diff',
  '  commond add [<path>...]     stage paths (everything when no path is given)',
  '  commond commit <message>    stage everything and commit',
  '  commond push                push the current branch',
  '  commond pull                pull with --ff-only',
  '',
  'turn the repo notice off with: setting commond off',
];

function extraArgs(ctx: CommandContext): string {
  return ctx.args.length > 0 ? ctx.args.map(shQuote).join(' ') : '';
}

function buildGitCommand(subcommand: string, ctx: CommandContext): string | null {
  const rest = ctx.args;
  switch (subcommand) {
    case 'status':
      return 'git status --short --branch';
    case 'log':
      return 'git log --oneline --decorate -10';
    case 'diff':
      return 'git diff';
    case 'add':
      return rest.length > 0 ? `git add ${extraArgs(ctx)}` : 'git add -A';
    case 'commit': {
      const message = rest.join(' ') || 'update';
      return `git add -A && git commit -m ${shQuote(message)}`;
    }
    case 'push':
      return 'git push';
    case 'pull':
      return 'git pull --ff-only';
    default:
      return null;
  }
}

export const commondCommand: CommandDefinition = {
  name: 'commond',
  usage: 'commond [status|log|diff|add|commit|push|pull]',
  summary: 'run common git commands through the native shell',
  async run(ctx: CommandContext): Promise<void> {
    const [subcommand] = ctx.args;
    if (!subcommand) {
      ctx.repl.sayLines(HELP);
      return;
    }
    const command = buildGitCommand(subcommand, ctx);
    if (!command) {
      ctx.repl.error(`unknown commond '${subcommand}'. available: status, log, diff, add, commit, push, pull.`);
      return;
    }
    await runNativeCommand({ repl: ctx.repl }, command);
  },
};
