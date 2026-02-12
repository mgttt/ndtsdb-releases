// ============================================================
// attach command - session attach 别名
// ============================================================

import { sessionCommand } from './session';

export async function attachCommand(
  args: string[],
  options: Record<string, string | boolean>
): Promise<void> {
  await sessionCommand(['attach', ...args], options, 'attach');
}
