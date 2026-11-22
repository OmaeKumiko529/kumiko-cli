import { createInterface, type Interface } from 'node:readline';
import pc from 'picocolors';
import { hasActiveRun, stopActiveRun } from './commands/run.js';
import { findCommand } from './commands/registry.js';
import type { GlobalConfig, SessionState } from './types.js';
import { promptFor, visibleLength } from './ui.js';

export class CommandCancelled extends Error {}

export class Repl {
  readonly state: SessionState = {};
  private readonly rl: Interface;
  private pendingResolve: ((line: string) => void) | null = null;
  private pendingReject: ((err: unknown) => void) | null = null;
  private running = false;
  private closed = false;
  private commandPrefix: string | null = null;

  constructor(readonly config: GlobalConfig) {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
      historySize: 200,
    });
    this.rl.on('line', (line) => {
      void this.onLine(line);
    });
    this.rl.on('SIGINT', () => this.onSigint());
    this.rl.on('close', () => {
      this.closed = true;
      this.rejectPending(new CommandCancelled());
    });
  }

  promptString(): string {
    return promptFor(this.commandPrefix ?? 'KUMIKOCLI', this.state);
  }

  say(text: string): void {
    process.stdout.write(this.promptString() + text + '\n');
  }

  sayLines(lines: string[]): void {
    if (lines.length === 0) return;
    this.say(lines[0]);
    const pad = ' '.repeat(visibleLength(this.promptString()));
    for (const line of lines.slice(1)) process.stdout.write(pad + line + '\n');
  }

  error(message: string): void {
    this.say(pc.red('error: ') + message);
  }

  setCommandPrefix(prefix: string | null): void {
    this.commandPrefix = prefix;
  }

  async ask(label: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.writePrompt(this.promptString() + label);
    });
  }

  quit(): void {
    this.closed = true;
    this.rl.close();
    // A piped stdin keeps the process alive unless it is explicitly paused.
    process.stdin.pause();
  }

  async start(): Promise<void> {
    this.showPrompt();
    if (this.closed) return;
    await new Promise<void>((resolve) => this.rl.once('close', () => resolve()));
  }

  private showPrompt(): void {
    this.writePrompt(this.promptString());
  }

  private writePrompt(text: string): void {
    if (this.closed) return;
    if (process.stdin.isTTY) {
      this.rl.setPrompt(text);
      this.rl.prompt();
    } else {
      // readline only renders prompts on TTY input; render manually for pipes
      // so scripted runs can observe where the CLI is waiting for input.
      process.stdout.write(text);
    }
  }

  private rejectPending(err: unknown): void {
    const reject = this.pendingReject;
    this.pendingResolve = null;
    this.pendingReject = null;
    reject?.(err);
  }

  private onSigint(): void {
    process.stdout.write('^C\n');
    if (this.pendingReject) {
      this.rejectPending(new CommandCancelled());
      return;
    }
    if (hasActiveRun()) {
      void stopActiveRun(this).finally(() => {
        if (!this.closed) this.showPrompt();
      });
      return;
    }
    if (!this.closed && !this.running) this.showPrompt();
  }

  private async onLine(line: string): Promise<void> {
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve(line);
      return;
    }
    if (this.closed || this.running) return;
    const input = line.trim();
    if (!input) {
      this.showPrompt();
      return;
    }
    await this.execute(input);
  }

  private async execute(input: string): Promise<void> {
    this.running = true;
    try {
      const tokens = input.split(/\s+/).filter(Boolean);
      if (tokens[0]?.toLowerCase() === 'kumiko') tokens.shift();
      if (tokens.length === 0) return;
      const command = findCommand(tokens[0]);
      if (!command) {
        this.error(`unknown command '${tokens[0]}'. type 'help' for the command list.`);
        return;
      }
      this.setCommandPrefix(command.promptPrefix ?? null);
      await command.run({ repl: this, config: this.config, args: tokens.slice(1) });
    } catch (err) {
      if (err instanceof CommandCancelled) this.say('cancelled.');
      else this.error(err instanceof Error ? err.message : String(err));
    } finally {
      this.running = false;
      this.setCommandPrefix(null);
      if (!this.closed) this.showPrompt();
    }
  }
}
