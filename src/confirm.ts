import type { Repl } from './repl.js';

export type ForceAction = 'push' | 'pull';

const WARNINGS: Record<ForceAction, string> = {
  push: 'WARNING --force will push all files and OVERWRITE your current branch. Input branch name to OVERWRITE: ',
  pull: 'WARNING --force will pull all files and OVERWRITE your current local workspace. Input branch name to OVERWRITE: ',
};

/**
 * Destructive operations must be confirmed by typing the branch name. Only the
 * trailing segment is required (branch `main/dev` is confirmed with `dev`).
 */
export async function confirmForce(repl: Repl, action: ForceAction, branch: string): Promise<boolean> {
  const expected = branch.split('/').filter(Boolean).pop() ?? branch;
  const answer = (await repl.ask(WARNINGS[action])).trim();
  return answer === expected;
}
