export interface ServerEntry {
  host: string;
  port: number;
  user: string;
  identity?: string;
  password?: string;
}

export interface GlobalConfig {
  servers: Record<string, ServerEntry>;
}

export interface ProjectConfig {
  project: { name: string };
  solution?: { name: string };
  run?: { command: string; port?: number };
  build?: { command: string; artifacts?: string };
  test?: { command: string };
  /** Branch tree: child branch ref -> parent branch ref. The main branch has no entry. */
  branches?: Record<string, string>;
  branch?: { syncChildren?: boolean };
  settings?: { commond?: boolean };
}

export interface SyncRecord {
  message: string;
  sha: string;
  branch: string;
  time: string;
  files: number;
}

export interface LocalProject {
  name: string;
  path: string;
  /** Display path of the current branch, e.g. `main` or `main/dev`. */
  branch?: string;
  configuredOnServer: boolean;
}

/** `kumiko` = the shell is pinned to the workspace root; `terminal` = the shell has a free cwd. */
export type ShellMode = 'kumiko' | 'terminal';

/** Native shell state, used by commands that are not kumiko commands. */
export interface ShellState {
  mode: ShellMode;
  /** Virtual path below the remote kumiko root (`$HOME/kumiko`); `''` means the root. */
  cwd: string;
}

export interface SessionState {
  server?: { name: string; entry: ServerEntry };
  project?: LocalProject;
  shell?: ShellState;
}
