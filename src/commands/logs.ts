import { loadHistory } from '../config.js';
import { gitShowCommitFiles } from '../git.js';
import type { SyncRecord } from '../types.js';
import { symbols } from '../ui.js';
import type { CommandContext, CommandDefinition } from './registry.js';

interface Tree {
  dirs: Map<string, Tree>;
  files: string[];
}

function newTree(): Tree {
  return { dirs: new Map(), files: [] };
}

function buildTree(paths: string[]): Tree {
  const root = newTree();
  for (const file of paths) {
    const parts = file.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      let child = node.dirs.get(dir);
      if (!child) {
        child = newTree();
        node.dirs.set(dir, child);
      }
      node = child;
    }
    node.files.push(parts[parts.length - 1]);
  }
  return root;
}

function renderTree(tree: Tree): string[] {
  const entries: Array<{ name: string; child?: Tree }> = [];
  for (const [name, child] of tree.dirs) entries.push({ name, child });
  for (const file of tree.files) entries.push({ name: file });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const lines: string[] = [];
  entries.forEach((entry, index) => {
    const last = index === entries.length - 1;
    lines.push(`${last ? symbols.end : symbols.mid} ${entry.name}`);
    if (entry.child) {
      const indent = last ? '   ' : '│  ';
      for (const line of renderTree(entry.child)) lines.push(indent + line);
    }
  });
  return lines;
}

function findRecord(records: SyncRecord[], target: string): SyncRecord | undefined {
  const needle = target.toLowerCase();
  const byExact = records.find((record) => record.sha.toLowerCase() === needle);
  if (byExact) return byExact;
  return records.find((record) => record.sha.toLowerCase().startsWith(needle));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const logsCommand: CommandDefinition = {
  name: 'logs',
  usage: 'logs [check <sha>]',
  summary: 'show sync history or the changed files of one sync',
  promptPrefix: 'LOGS',
  async run(ctx: CommandContext): Promise<void> {
    const project = ctx.repl.state.project;
    if (!project) {
      ctx.repl.error('no project selected. use `switch <project>[:branch]` first.');
      return;
    }
    const records = loadHistory(project.name);
    const [subcommand, target] = ctx.args;

    if (!subcommand) {
      if (records.length === 0) {
        ctx.repl.sayLines(['LOGS', '  no sync history for this project yet.']);
        return;
      }
      ctx.repl.sayLines(['LOGS', ...records.map((record) => `  '${record.message}':${record.sha.slice(0, 8)}`)]);
      return;
    }

    if (subcommand !== 'check' || !target) {
      throw new Error('usage: logs [check <sha>]');
    }

    const record = findRecord(records, target);
    if (!record) {
      ctx.repl.error(`no sync record '${target}' in the local history.`);
      return;
    }
    const files = gitShowCommitFiles(project.path, record.sha);
    const lines = [
      `${symbols.ok} '${record.message}':${record.sha.slice(0, 8)}`,
      `${symbols.ok} Push ${plural(record.files, 'changed file')} to ${project.name}:/${record.branch}`,
      ...(files.length > 0 ? renderTree(buildTree(files)) : []),
    ];
    ctx.repl.sayLines(lines);
  },
};
