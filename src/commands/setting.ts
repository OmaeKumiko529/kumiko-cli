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

const SETTINGS = ['syncChildren', 'commond'] as const;

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
      const syncChildren = config.branch?.syncChildren;
      const commond = config.settings?.commond;
      ctx.repl.sayLines([
        'settings:',
        `  syncChildren  ${syncChildren === false ? 'off' : 'on'}${syncChildren === undefined ? '  (default)' : ''}`,
        `  commond       ${commond === false ? 'off' : 'on'}${commond === undefined ? '  (default)' : ''}`,
        '',
        'syncChildren: push a parent sync to its child branches by default.',
        'commond:      show the "kumiko config in repo" notice for native git commands.',
        '',
        'change with: setting <name> on|off',
      ]);
      return;
    }
    if (!SETTINGS.includes(key as (typeof SETTINGS)[number])) {
      ctx.repl.error(`unknown setting '${key}'. available: ${SETTINGS.join(', ')}`);
      return;
    }
    const parsed = parseToggle(value);
    if (parsed === undefined) {
      ctx.repl.error(`usage: setting ${key} on|off`);
      return;
    }
    if (key === 'syncChildren') {
      saveProjectConfig(project.path, { ...config, branch: { ...(config.branch ?? {}), syncChildren: parsed } });
    } else {
      saveProjectConfig(project.path, { ...config, settings: { ...(config.settings ?? {}), commond: parsed } });
    }
    ctx.repl.say(`${successBadge()} ${key} is now ${parsed ? 'on' : 'off'}.`);
  },
};
