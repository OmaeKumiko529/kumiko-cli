import net from 'node:net';
import pc from 'picocolors';
import type { Client, ClientChannel } from 'ssh2';
import { loadProjectConfig } from '../config.js';
import { branchPathFor, branchRef, requireProject, resolveServer } from '../context.js';
import { gitCurrentBranch } from '../git.js';
import { remoteHome, remoteWorktreeState, shQuote, updateRemoteWorktree } from '../remote.js';
import { connectSsh, openExec, sshExec } from '../ssh.js';
import type { Repl } from '../repl.js';
import type { ServerEntry } from '../types.js';
import type { CommandContext, CommandDefinition } from './registry.js';

interface RunOptions {
  server?: string;
  localPort?: number;
  remotePort?: number;
}

interface RunSession {
  serverName: string;
  projectName: string;
  displayPath: string;
  entry: ServerEntry;
  client: Client;
  logStream: ClientChannel;
  forward: net.Server;
  localPort: number;
  remotePort: number;
  remotePid: string;
  pidPath: string;
}

let active: RunSession | null = null;

export function hasActiveRun(): boolean {
  return active !== null;
}

export function activeRunSummary(): string | null {
  if (!active) return null;
  return `${active.serverName}  ${active.projectName}:/${active.displayPath}  http://127.0.0.1:${active.localPort} -> :${active.remotePort}`;
}

function parseRunArgs(args: string[]): RunOptions {
  const options: RunOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    const next = args[index + 1];
    if ((arg === '-server' || arg === '--server' || arg === '-s') && next) {
      options.server = next;
      index += 1;
    } else if ((arg === '--port' || arg === '-p') && next) {
      options.localPort = Number(next);
      index += 1;
    } else if (arg === '--remote-port' && next) {
      options.remotePort = Number(next);
      index += 1;
    } else if (!arg.startsWith('-')) {
      throw new Error(
        `unexpected argument '${arg}'. usage: run [-server <name>] [--port <local>] [--remote-port <remote>]`,
      );
    }
  }
  return options;
}

function checkPort(port: number | undefined, label: string): number | undefined {
  if (port === undefined) return undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid ${label} port '${port}'.`);
  }
  return port;
}

function assertLocalPortFree(port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      reject(new Error(`local port ${port} is not available: ${(err as Error).message}`));
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve());
    });
  });
}

function logPrefix(): (text: string) => void {
  let carry = '';
  return (text: string) => {
    carry += text;
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';
    for (const line of lines) {
      process.stdout.write(pc.dim('run | ') + line.replace(/\r$/, '') + '\n');
    }
  };
}

async function startRun(ctx: CommandContext, args: string[]): Promise<void> {
  const { repl } = ctx;
  if (active) {
    repl.error(`a run session is already active: ${activeRunSummary() ?? ''}. use \`run stop\` first.`);
    return;
  }
  const options = parseRunArgs(args);
  const { name: serverName, entry } = resolveServer(ctx, options.server);
  const project = requireProject(ctx);
  const projectConfig = loadProjectConfig(project.path);
  if (!projectConfig) {
    repl.error(`no .kumiko.toml in ${project.path}. run \`sync\` first.`);
    return;
  }
  if (!projectConfig.run?.command) {
    repl.error('this project has no [run].command in .kumiko.toml. add one first.');
    return;
  }
  const currentRef = gitCurrentBranch(project.path) ?? 'main';
  const displayPath = project.branch ?? branchPathFor(projectConfig, currentRef);
  const ref = branchRef(displayPath);

  const state = await remoteWorktreeState(entry, project.name);
  if (state === 'absent') {
    repl.error(`no remote workspace for '${project.name}'. run \`sync\` first.`);
    return;
  }
  if (state === 'dirty') {
    repl.error(`the server workspace for '${project.name}' has uncommitted changes. run \`pull\` first.`);
    return;
  }
  await updateRemoteWorktree(entry, project.name, ref);

  const remotePort = checkPort(options.remotePort ?? projectConfig.run.port ?? 5173, 'remote') as number;
  const localPort = checkPort(options.localPort ?? remotePort, 'local') as number;
  await assertLocalPortFree(localPort);

  const home = await remoteHome(entry);
  const projectDir = `${home}/kumiko/projects/${project.name}`;
  const logPath = `${home}/kumiko/logs/${project.name}.run.log`;
  const pidPath = `${home}/kumiko/run/${project.name}.pid`;
  const launchPath = `${home}/kumiko/run/launch.sh`;

  const stale = await sshExec(
    entry,
    `if [ -s ${shQuote(pidPath)} ]; then kill -0 "$(cat ${shQuote(pidPath)})" 2>/dev/null && echo alive || echo stale; else echo none; fi`,
  );
  if (stale.stdout.trim() === 'alive') {
    repl.error(`a run process is already active on the server for '${project.name}'. stop it first.`);
    return;
  }

  const launcher = [
    '#!/bin/bash',
    '# kumiko run launcher: $1 pidfile, $2 logfile, $3 workdir, $4 command',
    'echo $$ > "$1"',
    'cd "$3" || exit 1',
    'exec bash -lc "$4" > "$2" 2>&1 < /dev/null',
  ].join('\n');
  const startScript = [
    `mkdir -p ${shQuote(`${home}/kumiko/logs`)} ${shQuote(`${home}/kumiko/run`)}`,
    `cat > ${shQuote(launchPath)} <<'KUMIKO_LAUNCH_EOF'`,
    launcher,
    'KUMIKO_LAUNCH_EOF',
    `chmod +x ${shQuote(launchPath)}`,
    `rm -f ${shQuote(pidPath)}`,
    `nohup setsid ${shQuote(launchPath)} ${shQuote(pidPath)} ${shQuote(logPath)} ${shQuote(projectDir)} ${shQuote(projectConfig.run.command)} < /dev/null > /dev/null 2>&1 &`,
    `for i in $(seq 1 50); do if [ -s ${shQuote(pidPath)} ]; then break; fi; sleep 0.1; done`,
    `cat ${shQuote(pidPath)}`,
  ].join('\n');
  const started = await sshExec(entry, startScript);
  const remotePid = started.stdout.trim().split('\n').pop() ?? '';
  if (!/^\d+$/.test(remotePid)) {
    repl.error(`could not start the run command on the server. ${started.stderr}`.trim());
    return;
  }

  let client: Client | null = null;
  let forward: net.Server | null = null;
  let logStream: ClientChannel | null = null;
  try {
    client = await connectSsh(entry);
    const forwardClient = client;
    forward = net.createServer((socket) => {
      forwardClient.forwardOut(
        '127.0.0.1',
        socket.remotePort ?? 0,
        '127.0.0.1',
        remotePort,
        (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          socket.on('error', () => stream.destroy());
          stream.on('error', () => socket.destroy());
          socket.pipe(stream).pipe(socket);
        },
      );
    });
    await new Promise<void>((resolve, reject) => {
      forward?.once('error', reject);
      forward?.listen(localPort, '127.0.0.1', () => resolve());
    });
    const logHandle = await openExec(client, `tail -n +1 -F ${shQuote(logPath)}`, logPrefix());
    logStream = logHandle.stream;
  } catch (err) {
    try {
      forward?.close();
    } catch {
      // best effort
    }
    try {
      client?.end();
    } catch {
      // best effort
    }
    await sshExec(entry, `kill -TERM -${remotePid} 2>/dev/null; rm -f ${shQuote(pidPath)}; true`).catch(() => undefined);
    repl.error(`could not start the run session: ${(err as Error).message}`);
    return;
  }

  active = {
    serverName,
    projectName: project.name,
    displayPath,
    entry,
    client,
    logStream,
    forward,
    localPort,
    remotePort,
    remotePid,
    pidPath,
  };
  repl.say(`forward http://127.0.0.1:${localPort} -> :${remotePort}`);
  repl.say(`server pid ${remotePid}. use \`run stop\` (or Ctrl-C) to stop.`);
}

export async function stopActiveRun(repl: Repl | null, silent = false): Promise<void> {
  if (!active) {
    if (!silent) repl?.say('no active run session.');
    return;
  }
  const session = active;
  active = null;
  try {
    session.logStream.close();
  } catch {
    // best effort
  }
  await new Promise<void>((resolve) => session.forward.close(() => resolve()));
  try {
    session.client.end();
  } catch {
    // best effort
  }
  try {
    await sshExec(
      session.entry,
      `kill -TERM -${session.remotePid} 2>/dev/null; sleep 1; kill -KILL -${session.remotePid} 2>/dev/null; rm -f ${shQuote(session.pidPath)}; true`,
    );
  } catch {
    // best effort: the server may be unreachable
  }
  if (!silent) repl?.say(`Done! run stopped for ${session.projectName}:/${session.displayPath}.`);
}

export const runCommand: CommandDefinition = {
  name: 'run',
  usage: 'run [-server <name>] [--port <local>] [--remote-port <remote>] | run stop',
  summary: 'run the project on the server and forward its dev port',
  promptPrefix: 'RUN',
  async run(ctx: CommandContext): Promise<void> {
    const [sub, ...rest] = ctx.args;
    if (sub === 'stop') {
      await stopActiveRun(ctx.repl);
      return;
    }
    if (sub === 'status') {
      ctx.repl.say(activeRunSummary() ?? 'no active run session.');
      return;
    }
    await startRun(ctx, ctx.args);
  },
};
