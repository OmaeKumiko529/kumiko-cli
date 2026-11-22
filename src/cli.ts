#!/usr/bin/env node
import { loadGlobalConfig } from './config.js';
import { Repl } from './repl.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') {
    process.stdout.write('kumiko 0.0.1\n');
    return;
  }
  const config = loadGlobalConfig();
  const repl = new Repl(config);
  await repl.start();
}

main().catch((err: unknown) => {
  process.stderr.write(`kumiko: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
