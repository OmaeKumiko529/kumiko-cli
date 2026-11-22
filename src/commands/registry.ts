import type { Repl } from '../repl.js';
import type { GlobalConfig } from '../types.js';
import { branchCommand } from './branch.js';
import { buildCommand } from './build.js';
import { logsCommand } from './logs.js';
import { pullCommand } from './pull.js';
import { runCommand } from './run.js';
import { exitCommand, helpCommand, statusCommand } from './misc.js';
import { serverCommand } from './server.js';
import { connectCommand, switchCommand } from './session.js';
import { settingCommand } from './setting.js';
import { syncCommand } from './sync.js';

export interface CommandContext {
  repl: Repl;
  config: GlobalConfig;
  args: string[];
}

export interface CommandDefinition {
  name: string;
  usage: string;
  summary: string;
  promptPrefix?: string;
  run(ctx: CommandContext): Promise<void>;
}

export const commands: CommandDefinition[] = [
  serverCommand,
  connectCommand,
  switchCommand,
  syncCommand,
  buildCommand,
  pullCommand,
  runCommand,
  branchCommand,
  settingCommand,
  logsCommand,
  statusCommand,
  helpCommand,
  exitCommand,
];

export function findCommand(name: string): CommandDefinition | undefined {
  return commands.find((command) => command.name === name);
}
