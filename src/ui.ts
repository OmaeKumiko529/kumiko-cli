import pc from 'picocolors';
import type { SessionState } from './types.js';

const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export function visibleLength(text: string): number {
  return [...stripAnsi(text)].length;
}

export const symbols = {
  ok: pc.green('[*]'),
  fail: pc.red('[X]'),
  mid: '├─',
  end: '└─',
};

/** A solid background chip, e.g. ` WARNING ` on yellow. Falls back to plain text without color. */
export function badge(label: string, background: (text: string) => string): string {
  if (!pc.isColorSupported) return label;
  return background(pc.bold(pc.black(` ${label} `)));
}

export function warningBadge(): string {
  return badge('WARNING', pc.bgYellow);
}

export function noticeBadge(): string {
  return badge('NOTICE', pc.bgCyan);
}

export function successBadge(): string {
  return badge('DONE', pc.bgGreen);
}

export function errorBadge(): string {
  return badge('ERROR', pc.bgRed);
}

export function contextFragment(state: SessionState): string {
  const parts: string[] = [];
  if (state.server) parts.push(pc.cyan(state.server.name));
  const shell = state.shell;
  const project = state.project;
  const terminalMode = shell?.mode === 'terminal';
  const terminalCwd = shell?.mode === 'terminal' ? shell.cwd : '';
  // A free terminal cwd replaces the workspace fragment: after
  // `switch current -terminal` the prompt shows `/projects/<name>` instead of
  // `name:/branch`, so it is obvious where native commands will run.
  if (project && !terminalMode) {
    if (project.configuredOnServer) {
      const branch = project.branch ? pc.magenta(`:/${project.branch}`) : '';
      parts.push(pc.green(project.name) + branch);
    } else {
      parts.push(pc.yellow(`*${project.name}`));
    }
  } else if (terminalCwd) {
    parts.push(pc.cyan(`/${terminalCwd}`));
  }
  return parts.join(' ');
}

export function promptFor(prefix: string, state: SessionState): string {
  const head = prefix === 'KUMIKOCLI' ? pc.bold(pc.magenta(prefix)) : pc.bold(pc.blue(prefix));
  const fragment = contextFragment(state);
  return `${head}${fragment ? ' ' + fragment : ''} ${pc.dim('$>')} `;
}

export function dim(text: string): string {
  return pc.dim(text);
}
