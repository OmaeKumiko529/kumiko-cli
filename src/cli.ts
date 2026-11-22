#!/usr/bin/env node
import { stopActiveRun } from './commands/run.js';
import { loadGlobalConfig } from './config.js';
import { Repl } from './repl.js';
import { errorBadge } from './ui.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') {
    process.stdout.write(`kumiko ${VERSION}\n`);
    return;
  }
  const config = loadGlobalConfig();
  const repl = new Repl(config);
  try {
    await repl.start();
  } finally {
    // never leave a remote dev process running after the REPL exits
    await stopActiveRun(null, true);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${errorBadge()} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
