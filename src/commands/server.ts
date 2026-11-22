import { saveGlobalConfig } from '../config.js';
import { checkServer } from '../ssh.js';
import type { ServerEntry } from '../types.js';
import { symbols } from '../ui.js';
import type { CommandContext, CommandDefinition } from './registry.js';

function parseSsh(input: string): { user: string; host: string; port: number } {
  const match = /^(?:([^@\s]+)@)?([^:\s]+)(?::(\d+))?$/.exec(input.trim());
  if (!match) throw new Error(`invalid ssh address '${input}', expected user@host[:port]`);
  return {
    user: match[1] ?? process.env.USER ?? 'root',
    host: match[2],
    port: Number(match[3] ?? 22),
  };
}

async function createServer(ctx: CommandContext): Promise<void> {
  const repl = ctx.repl;
  const name = (await repl.ask('serverName: ')).trim();
  if (!name) {
    repl.say('cancelled.');
    return;
  }
  if (ctx.config.servers[name]) {
    repl.say(`server '${name}' already exists. use \`server remove ${name}\` first.`);
    return;
  }
  const ssh = (await repl.ask('ssh: ')).trim();
  const password = (await repl.ask('password (empty = ssh key): ')).trim();
  let identity: string | undefined;
  if (!password) {
    identity = (await repl.ask('identity (private key path, empty = ssh-agent): ')).trim() || undefined;
  }
  const { user, host, port } = parseSsh(ssh);
  const entry: ServerEntry = { host, port, user, identity, password: password || undefined };
  repl.say(`test ssh in ${host} of ${user}...`);
  const check = await checkServer(entry);
  if (!check.reachable) {
    repl.say('failed: connection not responding. check host / user / key or password.');
    return;
  }
  if (check.reasons.length > 0) {
    repl.say(`warning: ${check.reasons.join(' ')}`);
  }
  ctx.config.servers[name] = entry;
  saveGlobalConfig(ctx.config);
  repl.say('Done! use `server list` to check your new server.');
}

function listServers(ctx: CommandContext): void {
  const names = Object.keys(ctx.config.servers).sort();
  if (names.length === 0) {
    ctx.repl.say('no server configured. use `server create`.');
    return;
  }
  ctx.repl.sayLines(
    names.map((name) => {
      const entry = ctx.config.servers[name];
      return `${name}:${entry.user}@${entry.host}`;
    }),
  );
}

async function testServers(ctx: CommandContext): Promise<void> {
  const names = Object.keys(ctx.config.servers).sort();
  if (names.length === 0) {
    ctx.repl.say('no server configured. use `server create`.');
    return;
  }
  const lines: string[] = [];
  for (const name of names) {
    const entry = ctx.config.servers[name];
    const check = await checkServer(entry);
    const label = `${name}:${entry.user}@${entry.host}`;
    if (check.reachable && check.git && check.docker) {
      lines.push(`${symbols.ok} ${label}`);
      continue;
    }
    lines.push(`${symbols.fail} ${label}`);
    const reasons = check.reachable ? check.reasons : ['Connection not responding.'];
    reasons.forEach((reason, index) => {
      lines.push(` ${index === reasons.length - 1 ? symbols.end : symbols.mid} ${reason}`);
    });
  }
  ctx.repl.sayLines(lines);
}

async function removeServer(ctx: CommandContext): Promise<void> {
  const name = ctx.args[0];
  if (!name || !ctx.config.servers[name]) {
    ctx.repl.say(`server '${name ?? ''}' not found.`);
    return;
  }
  delete ctx.config.servers[name];
  saveGlobalConfig(ctx.config);
  ctx.repl.say(`removed server '${name}'.`);
}

export const serverCommand: CommandDefinition = {
  name: 'server',
  usage: 'server create | list | test | remove <name>',
  summary: 'manage servers',
  promptPrefix: 'SERVER',
  async run(ctx: CommandContext): Promise<void> {
    const [subcommand, ...rest] = ctx.args;
    const subCtx: CommandContext = { ...ctx, args: rest };
    switch (subcommand) {
      case 'create':
        return createServer(subCtx);
      case 'list':
        return listServers(subCtx);
      case 'test':
        return testServers(subCtx);
      case 'remove':
        return removeServer(subCtx);
      case undefined:
        ctx.repl.say('usage: server create | list | test | remove <name>');
        return;
      default:
        ctx.repl.say(`unknown server subcommand '${subcommand}'.`);
    }
  },
};
