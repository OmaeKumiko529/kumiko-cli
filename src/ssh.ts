import { readFileSync } from 'node:fs';
import { Client } from 'ssh2';
import type { ServerEntry } from './types.js';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ServerCheck {
  reachable: boolean;
  git: boolean;
  docker: boolean;
  reasons: string[];
}

function connectionConfig(entry: ServerEntry): Record<string, unknown> {
  const config: Record<string, unknown> = {
    host: entry.host,
    port: entry.port,
    username: entry.user,
    readyTimeout: 10_000,
    keepaliveInterval: 5_000,
  };
  if (entry.identity) config.privateKey = readFileSync(entry.identity);
  else if (entry.password) config.password = entry.password;
  return config;
}

export async function withSsh<T>(entry: ServerEntry, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', (err) => reject(err));
    client.connect(connectionConfig(entry) as never);
  });
  try {
    return await fn(client);
  } finally {
    client.end();
  }
}

export function execOn(client: Client, command: string): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      stream.on('close', (code: number) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
  });
}

export async function sshExec(entry: ServerEntry, command: string): Promise<ExecResult> {
  return withSsh(entry, (client) => execOn(client, command));
}

export async function checkServer(entry: ServerEntry): Promise<ServerCheck> {
  const check: ServerCheck = { reachable: false, git: false, docker: false, reasons: [] };
  try {
    await withSsh(entry, async (client) => {
      check.reachable = true;
      const git = await execOn(client, "bash -lc 'git --version'");
      check.git = git.code === 0;
      if (!check.git) check.reasons.push('Git is unavailable.');
      const docker = await execOn(client, "bash -lc 'docker --version'");
      check.docker = docker.code === 0;
      if (!check.docker) check.reasons.push('Docker is unavailable.');
    });
  } catch {
    check.reachable = false;
    check.git = false;
    check.docker = false;
    check.reasons = ['Connection not responding.'];
  }
  return check;
}
