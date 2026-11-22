import { createInterface, type Interface } from 'node:readline';
import { hasActiveRun, stopActiveRun } from './commands/run.js';
import { findCommand } from './commands/registry.js';
import type { GlobalConfig, SessionState } from './types.js';
import { errorBadge, promptFor, visibleLength } from './ui.js';

export class CommandCancelled extends Error {}

export class Repl {
  readonly state: SessionState = {};
  private readonly rl: Interface;
  private pendingResolve: ((line: string) => void) | null = null;
  private pendingReject: ((err: unknown) => void) | null = null;
  private running = false;
  private closed = false;
  private commandPrefix: string | null = null;
  private readonly inputQueue: string[] = [];
  private pumpPromise: Promise<void> | null = null;

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
    this.say(`${errorBadge()} ${message}`);
  }

  setCommandPrefix(prefix: string | null): void {
    this.commandPrefix = prefix;
  }

  async ask(label: string): Promise<string> {
    const prompt = this.promptString() + label;
    // Piped input can arrive before the command reaches its next question.
    if (this.inputQueue.length > 0) {
      this.writePrompt(prompt);
      return this.inputQueue.shift() as string;
    }
    if (this.closed) throw new CommandCancelled();
    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.writePrompt(prompt);
    });
  }

  quit(): void {
    this.closed = true;
    this.inputQueue.length = 0;
    this.rl.close();
    // A piped stdin keeps the process alive unless it is explicitly paused.
    process.stdin.pause();
  }

  async start(): Promise<void> {
    this.showPrompt();
    if (this.closed) return;
    await new Promise<void>((resolve) => this.rl.once('close', () => resolve()));
    // Piped stdin can deliver every line and close before the last command has
    // finished; finish the queued commands before the process is allowed to exit.
    await this.pump();
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
    this.inputQueue.push(line);
    await this.pump();
  }

  private pump(): Promise<void> {
    if (!this.pumpPromise) {
      this.pumpPromise = this.pumpLoop().finally(() => {
        this.pumpPromise = null;
      });
    }
    return this.pumpPromise;
  }

  private async pumpLoop(): Promise<void> {
    while (this.inputQueue.length > 0) {
      const line = this.inputQueue.shift() as string;
      const input = line.trim();
      if (!input) {
        this.showPrompt();
        continue;
      }
      if (this.running) {
        this.inputQueue.unshift(line);
        return;
      }
      await this.execute(input);
    }
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
