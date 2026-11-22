import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { GlobalConfig, ProjectConfig, ServerEntry, SyncRecord } from './types.js';

export const KUMIKO_HOME = path.join(homedir(), '.kumiko');
export const GLOBAL_CONFIG_PATH = path.join(KUMIKO_HOME, 'config.toml');
export const SOLUTIONS_DIR = path.join(KUMIKO_HOME, 'sol');
export const HISTORY_DIR = path.join(KUMIKO_HOME, 'history');

function ensureKumikoHome(): void {
  if (!existsSync(KUMIKO_HOME)) mkdirSync(KUMIKO_HOME, { recursive: true });
}

function safeProjectName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

function tomlString(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return JSON.stringify(value);
}

export function loadGlobalConfig(): GlobalConfig {
  ensureKumikoHome();
  if (!existsSync(GLOBAL_CONFIG_PATH)) return { servers: {} };
  const raw = readFileSync(GLOBAL_CONFIG_PATH, 'utf8');
  let data: Record<string, unknown>;
  try {
    data = parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`cannot parse ${GLOBAL_CONFIG_PATH}: ${(err as Error).message}`);
  }
  const servers: Record<string, ServerEntry> = {};
  const rawServers = (data.servers ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, entry] of Object.entries(rawServers)) {
    if (!entry || typeof entry.host !== 'string' || typeof entry.user !== 'string') continue;
    servers[name] = {
      host: entry.host,
      port: typeof entry.port === 'number' ? entry.port : 22,
      user: entry.user,
      identity: typeof entry.identity === 'string' ? entry.identity : undefined,
      password: typeof entry.password === 'string' ? entry.password : undefined,
    };
  }
  return { servers };
}

export function saveGlobalConfig(config: GlobalConfig): void {
  ensureKumikoHome();
  const lines: string[] = ['# KUMIKO CLI global config. Servers only, never commit this file.'];
  for (const [name, entry] of Object.entries(config.servers)) {
    lines.push('', `[servers.${name}]`, `host = ${tomlString(entry.host)}`, `port = ${entry.port}`, `user = ${tomlString(entry.user)}`);
    if (entry.identity) lines.push(`identity = ${tomlString(entry.identity)}`);
    if (entry.password) lines.push(`password = ${tomlString(entry.password)}`);
  }
  writeFileSync(GLOBAL_CONFIG_PATH, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
}

export function loadProjectConfig(dir: string): ProjectConfig | null {
  const file = path.join(dir, '.kumiko.toml');
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8');
  let data: Record<string, unknown>;
  try {
    data = parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`cannot parse ${file}: ${(err as Error).message}`);
  }
  const project = (data.project ?? {}) as Record<string, unknown>;
  const solution = data.solution as Record<string, unknown> | undefined;
  const run = data.run as Record<string, unknown> | undefined;
  const build = data.build as Record<string, unknown> | undefined;
  const test = data.test as Record<string, unknown> | undefined;
  return {
    project: { name: typeof project.name === 'string' ? project.name : path.basename(dir) },
    solution: solution?.name ? { name: String(solution.name) } : undefined,
    run: run?.command ? { command: String(run.command) } : undefined,
    build: build?.command
      ? { command: String(build.command), artifacts: build.artifacts ? String(build.artifacts) : undefined }
      : undefined,
    test: test?.command ? { command: String(test.command) } : undefined,
  };
}

export function saveProjectConfig(dir: string, config: ProjectConfig): void {
  const lines = ['# KUMIKO CLI toolchain record. Commit this file and sync it with the project.', '', '[project]', `name = ${tomlString(config.project.name)}`];
  if (config.solution?.name) lines.push('', '[solution]', `name = ${tomlString(config.solution.name)}`);
  if (config.run?.command) lines.push('', '[run]', `command = ${tomlString(config.run.command)}`);
  if (config.build?.command) {
    lines.push('', '[build]', `command = ${tomlString(config.build.command)}`);
    if (config.build.artifacts) lines.push(`artifacts = ${tomlString(config.build.artifacts)}`);
  }
  if (config.test?.command) lines.push('', '[test]', `command = ${tomlString(config.test.command)}`);
  writeFileSync(path.join(dir, '.kumiko.toml'), lines.join('\n') + '\n', 'utf8');
}

/** Solutions are reusable toolchain presets stored in ~/.kumiko/sol/<name>.sol (TOML without [project]). */
export function listSolutions(): string[] {
  if (!existsSync(SOLUTIONS_DIR)) return [];
  return readdirSync(SOLUTIONS_DIR)
    .filter((file) => file.endsWith('.sol'))
    .map((file) => file.slice(0, -'.sol'.length))
    .sort();
}

export function loadSolution(name: string): ProjectConfig | null {
  const file = path.join(SOLUTIONS_DIR, `${name}.sol`);
  if (!existsSync(file)) return null;
  const data = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const run = data.run as Record<string, unknown> | undefined;
  const build = data.build as Record<string, unknown> | undefined;
  const test = data.test as Record<string, unknown> | undefined;
  return {
    project: { name: name },
    solution: { name },
    run: run?.command ? { command: String(run.command) } : undefined,
    build: build?.command
      ? { command: String(build.command), artifacts: build.artifacts ? String(build.artifacts) : undefined }
      : undefined,
    test: test?.command ? { command: String(test.command) } : undefined,
  };
}

function historyFile(projectName: string): string {
  ensureKumikoHome();
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  return path.join(HISTORY_DIR, `${safeProjectName(projectName)}.jsonl`);
}

export function loadHistory(projectName: string): SyncRecord[] {
  const file = historyFile(projectName);
  if (!existsSync(file)) return [];
  const records: SyncRecord[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as SyncRecord);
    } catch {
      // ignore malformed history line
    }
  }
  return records;
}

export function appendHistory(projectName: string, record: SyncRecord): void {
  appendFileSync(historyFile(projectName), JSON.stringify(record) + '\n', 'utf8');
}
