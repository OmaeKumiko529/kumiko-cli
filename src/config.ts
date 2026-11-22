import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { GlobalConfig, ProjectConfig, ServerEntry } from './types.js';

export const KUMIKO_HOME = path.join(homedir(), '.kumiko');
export const GLOBAL_CONFIG_PATH = path.join(KUMIKO_HOME, 'config.toml');

function ensureKumikoHome(): void {
  if (!existsSync(KUMIKO_HOME)) mkdirSync(KUMIKO_HOME, { recursive: true });
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
