import { rmSync } from 'node:fs';
import path from 'node:path';
import { loadProjectConfig } from '../config.js';
import { branchPathFor, branchRef, requireProject, resolveServer } from '../context.js';
import { gitCurrentBranch } from '../git.js';
import { remoteHome, remoteWorktreeState, shQuote, updateRemoteWorktree } from '../remote.js';
import { sftpDownloadDir, sshExec, sshExecStream } from '../ssh.js';
import { successBadge } from '../ui.js';
import type { CommandContext, CommandDefinition } from './registry.js';

interface BuildOptions {
  artifacts: boolean;
  serverName?: string;
}

function parseBuildArgs(args: string[]): BuildOptions {
  const options: BuildOptions = { artifacts: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-artifacts' || arg === '--artifacts') {
      options.artifacts = true;
    } else if (arg === '-server' || arg === '--server' || arg === '-s') {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} needs a server name`);
      options.serverName = value;
      index += 1;
    } else {
      throw new Error(`unknown build option '${arg}'`);
    }
  }
  return options;
}

function normalizeArtifacts(value: string | undefined): string {
  const raw = (value ?? 'dist').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!raw) throw new Error('build artifacts path is empty');
  if (raw.startsWith('/') || raw.split('/').includes('..')) {
    throw new Error(`build artifacts must be a relative path inside the project: '${value}'`);
  }
  return raw;
}

export const buildCommand: CommandDefinition = {
  name: 'build',
  usage: 'build [-server <name>] [-artifacts]',
  summary: 'run the configured build command on the server',
  promptPrefix: 'BUILD',
  async run(ctx: CommandContext): Promise<void> {
    const options = parseBuildArgs(ctx.args);
    const server = resolveServer(ctx, options.serverName);
    const project = requireProject(ctx);

    const projectConfig = loadProjectConfig(project.path);
    if (!projectConfig) {
      ctx.repl.error(`no .kumiko.toml in '${project.name}'. run \`sync\` once to create it.`);
      return;
    }
    if (!projectConfig.build?.command) {
      ctx.repl.error("no build command configured in .kumiko.toml ([build] command = '...').");
      return;
    }
    const commandLine = projectConfig.build.command;
    const artifacts = normalizeArtifacts(projectConfig.build.artifacts);

    const remoteState = await remoteWorktreeState(server.entry, project.name);
    if (remoteState === 'absent') {
      ctx.repl.error(`no remote workspace for '${project.name}'. run \`sync\` first.`);
      return;
    }
    const branch = project.branch ?? branchPathFor(projectConfig, gitCurrentBranch(project.path) ?? 'main');
    await updateRemoteWorktree(server.entry, project.name, branchRef(branch));

    const remoteProject = `"$HOME/kumiko/projects/${project.name}"`;
    const result = await sshExecStream(server.entry, `cd ${remoteProject} && bash -lc ${shQuote(commandLine)}`, (chunk) =>
      process.stdout.write(chunk),
    );
    if (result.code !== 0) {
      ctx.repl.error(`build failed with exit code ${result.code}.`);
      return;
    }

    if (!options.artifacts) {
      ctx.repl.setCommandPrefix('KUMIKOCLI');
      ctx.repl.say(`${successBadge()} Build at @/${artifacts} remotely.`);
      return;
    }

    const home = await remoteHome(server.entry);
    const remoteArtifacts = `${home}/kumiko/projects/${project.name}/${artifacts}`;
    const exists = await sshExec(server.entry, `test -e ${shQuote(remoteArtifacts)} && echo yes || echo no`);
    if (exists.stdout.trim() !== 'yes') {
      ctx.repl.error(`the build produced no artifacts at @/${artifacts}.`);
      return;
    }
    const localArtifacts = path.join(project.path, artifacts);
    rmSync(localArtifacts, { recursive: true, force: true });
    await sftpDownloadDir(server.entry, remoteArtifacts, localArtifacts);
    ctx.repl.setCommandPrefix('KUMIKOCLI');
    ctx.repl.say(`${successBadge()} Build at *@/${artifacts} locally.`);
  },
};
