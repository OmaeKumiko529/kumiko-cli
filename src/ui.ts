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

export function contextFragment(state: SessionState): string {
  const parts: string[] = [];
  if (state.server) parts.push(pc.cyan(state.server.name));
  const project = state.project;
  if (project) {
    if (project.configuredOnServer) {
      const branch = project.branch ? pc.magenta(`:/${project.branch}`) : '';
      parts.push(pc.green(project.name) + branch);
    } else {
      parts.push(pc.yellow(`*${project.name}`));
    }
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
