import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'ssh2';
import type { ClientChannel, FileEntryWithStats, SFTPWrapper } from 'ssh2';
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

/** Open a plain ssh connection. The caller owns the client and must end it. */
export function connectSsh(entry: ServerEntry): Promise<Client> {
  const client = new Client();
  return new Promise<Client>((resolve, reject) => {
    client.once('ready', () => resolve(client));
    client.once('error', (err) => reject(err));
    client.connect(connectionConfig(entry) as never);
  });
}

export async function withSsh<T>(entry: ServerEntry, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connectSsh(entry);
  try {
    return await fn(client);
  } finally {
    client.end();
  }
}

export interface StreamHandle {
  stream: ClientChannel;
  done: Promise<ExecResult>;
}

/** Like execOn, but hands back the live channel so long-running output can be cut short. */
export function openExec(
  client: Client,
  command: string,
  onOutput?: (chunk: string) => void,
): Promise<StreamHandle> {
  return new Promise<StreamHandle>((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        onOutput?.(text);
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr += text;
        onOutput?.(text);
      });
      const done = new Promise<ExecResult>((settle) => {
        stream.on('close', (code: number) =>
          settle({ code, stdout: stdout.trim(), stderr: stderr.trim() }),
        );
      });
      resolve({ stream, done });
    });
  });
}

export async function execOn(
  client: Client,
  command: string,
  onOutput?: (chunk: string) => void,
): Promise<ExecResult> {
  const handle = await openExec(client, command, onOutput);
  return handle.done;
}

export async function sshExec(entry: ServerEntry, command: string): Promise<ExecResult> {
  return withSsh(entry, (client) => execOn(client, command));
}

/** Like sshExec, but forwards output as it arrives (used for long-running builds). */
export async function sshExecStream(
  entry: ServerEntry,
  command: string,
  onOutput: (chunk: string) => void,
): Promise<ExecResult> {
  return withSsh(entry, (client) => execOn(client, command, onOutput));
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err);
      else resolve(sftp);
    });
  });
}

function sftpReaddir(sftp: SFTPWrapper, remotePath: string): Promise<FileEntryWithStats[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => (err ? reject(err) : resolve(list)));
  });
}

function sftpFastGet(sftp: SFTPWrapper, remotePath: string, localPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (err) => (err ? reject(err) : resolve()));
  });
}

async function downloadTree(sftp: SFTPWrapper, remoteDir: string, localDir: string): Promise<void> {
  const entries = await sftpReaddir(sftp, remoteDir);
  mkdirSync(localDir, { recursive: true });
  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') continue;
    const remotePath = path.posix.join(remoteDir, entry.filename);
    const localPath = path.join(localDir, entry.filename);
    if (entry.attrs.isDirectory()) await downloadTree(sftp, remotePath, localPath);
    else if (entry.attrs.isFile()) await sftpFastGet(sftp, remotePath, localPath);
    // symlinks are intentionally skipped: they can create cycles
  }
}

/** Recursively download a remote directory to a local directory. */
export async function sftpDownloadDir(entry: ServerEntry, remotePath: string, localPath: string): Promise<void> {
  await withSsh(entry, async (client) => {
    const sftp = await openSftp(client);
    try {
      await downloadTree(sftp, remotePath, localPath);
    } finally {
      sftp.end();
    }
  });
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
