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
}

export interface LocalProject {
  name: string;
  path: string;
  branch?: string;
  configuredOnServer: boolean;
}

export interface SessionState {
  server?: { name: string; entry: ServerEntry };
  project?: LocalProject;
}
