import { readFileSync } from 'node:fs';
import { saveGlobalConfig } from '../config.js';
import { shQuote } from '../remote.js';
import { checkServer, execOn, withSsh } from '../ssh.js';
import type { ServerEntry } from '../types.js';
import { successBadge, symbols, warningBadge } from '../ui.js';
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

function assertReadableKey(identity: string): void {
  try {
    readFileSync(identity);
  } catch {
    throw new Error(`cannot read private key '${identity}'`);
  }
}

function publicKeyFor(identity: string): string | undefined {
  try {
    const key = readFileSync(`${identity}.pub`, 'utf8').trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

function keyEntry(entry: ServerEntry, identity: string): ServerEntry {
  return { host: entry.host, port: entry.port, user: entry.user, identity };
}

/** Append a public key to authorized_keys over a password-authenticated session. */
async function installPublicKey(passwordEntry: ServerEntry, publicKey: string): Promise<void> {
  const key = shQuote(publicKey);
  await withSsh(passwordEntry, (client) =>
    execOn(
      client,
      `mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" && touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys" && { grep -qxF ${key} "$HOME/.ssh/authorized_keys" || echo ${key} >> "$HOME/.ssh/authorized_keys"; }`,
    ),
  );
}

async function tryInstallAndVerify(entry: ServerEntry, identity: string): Promise<boolean> {
  const publicKey = publicKeyFor(identity);
  if (!publicKey || !entry.password) return false;
  try {
    await installPublicKey(entry, publicKey);
  } catch {
    return false;
  }
  const check = await checkServer(keyEntry(entry, identity));
  return check.reachable;
}

/** `server key <name> [identity]`: attach a key to an existing server without recreating it. */
async function setServerKey(ctx: CommandContext): Promise<void> {
  const repl = ctx.repl;
  const name = ctx.args[0];
  if (!name || !ctx.config.servers[name]) {
    repl.say(`server '${name ?? ''}' not found.`);
    return;
  }
  const entry = ctx.config.servers[name];
  let identity = (ctx.args[1] ?? '').trim();
  if (!identity) identity = (await repl.ask('identity (private key path): ')).trim();
  if (!identity) {
    repl.say('cancelled.');
    return;
  }
  assertReadableKey(identity);
  repl.say(`test ssh in ${entry.host} of ${entry.user}...`);
  const check = await checkServer(keyEntry(entry, identity));
  if (check.reachable) {
    ctx.config.servers[name] = keyEntry(entry, identity);
    saveGlobalConfig(ctx.config);
    repl.say(`${successBadge()} key login works. using '${identity}' for '${name}'.`);
    return;
  }
  if (entry.password && (await tryInstallAndVerify(entry, identity))) {
    ctx.config.servers[name] = keyEntry(entry, identity);
    saveGlobalConfig(ctx.config);
    repl.say(`${successBadge()} installed the public key. using key login for '${name}'.`);
    return;
  }
  repl.say(
    `key login failed. make sure '${identity}.pub' is in ~/.ssh/authorized_keys on the server (or re-create the server with password + identity).`,
  );
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
  const identity = (await repl.ask('identity (private key path, empty = ssh-agent): ')).trim() || undefined;
  if (!password && !identity) {
    repl.say(`${warningBadge()} no key and no password: git operations will need an ssh-agent key.`);
  }
  const { user, host, port } = parseSsh(ssh);
  const passwordEntry: ServerEntry = { host, port, user, password: password || undefined };
  repl.say(`test ssh in ${host} of ${user}...`);
  const testEntry = password ? passwordEntry : { host, port, user, identity };
  const check = await checkServer(testEntry);
  if (!check.reachable) {
    repl.say('failed: connection not responding. check host / user / key or password.');
    return;
  }
  if (check.reasons.length > 0) {
    repl.say(`${warningBadge()} ${check.reasons.join(' ')}`);
  }
  let entry: ServerEntry = testEntry;
  if (password && identity) {
    if (await tryInstallAndVerify(passwordEntry, identity)) {
      entry = keyEntry(passwordEntry, identity);
      repl.say('key login verified; the password is not stored.');
    } else {
      entry = { ...passwordEntry, identity };
      repl.say(`${warningBadge()} key login not verified yet; keeping the password as a fallback.`);
    }
  } else if (password) {
    repl.say(
      `${warningBadge()} sync/build/pull need a key. run \`server key ${name} <path to private key>\` when you have one.`,
    );
  }
  ctx.config.servers[name] = entry;
  saveGlobalConfig(ctx.config);
  repl.say(`${successBadge()} use \`server list\` to check your new server.`);
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
  usage: 'server create | list | test | remove <name> | key <name> [identity]',
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
      case 'key':
        return setServerKey(subCtx);
      case undefined:
        ctx.repl.say('usage: server create | list | test | remove <name> | key <name> [identity]');
        return;
      default:
        ctx.repl.say(`unknown server subcommand '${subcommand}'.`);
    }
  },
};
