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
  run?: { command: string };
  build?: { command: string; artifacts?: string };
  test?: { command: string };
  /** Branch tree: child branch ref -> parent branch ref. The main branch has no entry. */
  branches?: Record<string, string>;
  branch?: { syncChildren?: boolean };
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

export interface SessionState {
  server?: { name: string; entry: ServerEntry };
  project?: LocalProject;
}
