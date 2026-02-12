// ============================================================
// sh command - session new 别名
// ============================================================

import { sessionCommand } from './session';

export async function shCommand(
  args: string[],
  options: Record<string, string | boolean>
): Promise<void> {
  await sessionCommand(['new', ...args], options, 'new');
}
