// ============================================================
// kill command - 停止所有进程并关闭 daemon
// ============================================================

import type { Daemon } from '../../daemon/Daemon';

export async function killCommand(
  _args: string[],
  _options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  console.log('[wp] 正在停止所有进程并关闭 daemon...');
  
  try {
    // 先停止所有进程
    const list = await daemon.sendCommand({ action: 'list', payload: {} });
    if (list.ok && Array.isArray(list.data)) {
      const processes = list.data.filter((p: any) => p.status === 'online');
      console.log(`[wp] 停止 ${processes.length} 个进程...`);
      
      for (const proc of processes) {
        try {
          await daemon.sendCommand({ action: 'stop', payload: { name: proc.name } });
          console.log(`[wp] 已停止: ${proc.name}`);
        } catch {}
      }
    }

    // 关闭 daemon
    await daemon.stop();
    console.log('[wp] daemon 已关闭');
  } catch (err) {
    console.error(`[wp] 关闭失败: ${err}`);
    process.exit(1);
  }
}
