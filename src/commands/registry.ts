import type { Repl } from '../repl.js';
import type { GlobalConfig } from '../types.js';
import { exitCommand, helpCommand, statusCommand } from './misc.js';
import { serverCommand } from './server.js';
import { connectCommand, switchCommand } from './session.js';

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
  statusCommand,
  helpCommand,
  exitCommand,
];

export function findCommand(name: string): CommandDefinition | undefined {
  return commands.find((command) => command.name === name);
}
