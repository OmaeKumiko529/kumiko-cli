import { loadProjectConfig, saveProjectConfig } from '../config.js';
import { requireProject } from '../context.js';
import { successBadge } from '../ui.js';
import type { CommandContext, CommandDefinition } from './registry.js';

function parseToggle(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  return undefined;
}

export const settingCommand: CommandDefinition = {
  name: 'setting',
  usage: 'setting [<name> on|off]',
  summary: 'show or change project settings',
  promptPrefix: 'SETTING',
  async run(ctx: CommandContext): Promise<void> {
    const project = requireProject(ctx);
    const config = loadProjectConfig(project.path);
    if (!config) {
      ctx.repl.error(`no .kumiko.toml in '${project.name}'. run \`sync\` once to create it.`);
      return;
    }

    const [key, value] = ctx.args;
    if (!key) {
      const stored = config.branch?.syncChildren;
      ctx.repl.sayLines([
        'settings:',
        `  syncChildren  ${stored === false ? 'off' : 'on'}${stored === undefined ? '  (default)' : ''}`,
        '',
        'change with: setting syncChildren on|off',
      ]);
      return;
    }
    if (key !== 'syncChildren') {
      ctx.repl.error(`unknown setting '${key}'. available: syncChildren`);
      return;
    }
    const parsed = parseToggle(value);
    if (parsed === undefined) {
      ctx.repl.error('usage: setting syncChildren on|off');
      return;
    }
    saveProjectConfig(project.path, { ...config, branch: { ...(config.branch ?? {}), syncChildren: parsed } });
    ctx.repl.say(`${successBadge()} syncChildren is now ${parsed ? 'on' : 'off'}.`);
  },
};
