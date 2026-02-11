// ============================================================
// signal command - 发送信号给进程
// ============================================================

import type { Daemon } from '../../daemon/Daemon';

export async function signalCommand(
  args: string[],
  _options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  const name = args[0];
  const sig = args[1] as NodeJS.Signals;

  if (!name || !sig) {
    console.error('错误: 请指定进程名和信号');
    console.error('用法: wp signal <name> <SIGUSR1|SIGHUP|SIGTERM|...>');
    process.exit(1);
  }

  console.log(`[wp] 发送信号 ${sig} 到进程: ${name}`);
  
  try {
    await daemon.sendCommand({
      action: 'signal',
      payload: { name, signal: sig },
    });
    console.log(`[wp] 信号已发送`);
  } catch (err) {
    console.error(`[wp] 发送失败: ${err}`);
    process.exit(1);
  }
}
