// ============================================================
// restart command - 重启进程
// ============================================================

import type { Daemon } from '../../daemon/Daemon';

export async function restartCommand(
  args: string[],
  options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  const target = args[0];
  
  // 按 group 重启
  if (options.group) {
    const group = options.group as string;
    console.log(`[wp] 重启 group: ${group}`);
    
    const list = await daemon.sendCommand({ action: 'list', payload: {} });
    if (!list.ok || !Array.isArray(list.data)) {
      console.error('[wp] 获取进程列表失败');
      process.exit(1);
    }

    const processes = list.data.filter((p: any) => 
      p.config?.group === group && p.status === 'online'
    );
    
    console.log(`[wp] 重启 ${processes.length} 个进程...`);
    for (const proc of processes) {
      try {
        await daemon.sendCommand({ action: 'restart', payload: { name: proc.name } });
        console.log(`[wp] 已重启: ${proc.name}`);
      } catch (err) {
        console.error(`[wp] 重启失败: ${proc.name}`, err);
      }
    }
    return;
  }
  
  if (!target) {
    console.error('错误: 请指定进程名或 all');
    console.error('用法: wp restart <name|all> [--group <group>]');
    process.exit(1);
  }

  if (target === 'all') {
    // 重启所有进程
    const list = await daemon.sendCommand({ action: 'list', payload: {} });
    if (!list.ok || !Array.isArray(list.data)) {
      console.error('[wp] 获取进程列表失败');
      process.exit(1);
    }

    const processes = list.data.filter((p: any) => p.status === 'online');
    console.log(`[wp] 重启 ${processes.length} 个进程...`);

    for (const proc of processes) {
      try {
        await daemon.sendCommand({ action: 'restart', payload: { name: proc.name } });
        console.log(`[wp] 已重启: ${proc.name}`);
      } catch (err) {
        console.error(`[wp] 重启失败: ${proc.name}`, err);
      }
    }
  } else {
    // 重启单个进程
    console.log(`[wp] 重启进程: ${target}`);
    try {
      await daemon.sendCommand({ action: 'restart', payload: { name: target } });
      console.log(`[wp] 已重启: ${target}`);
    } catch (err) {
      console.error(`[wp] 重启失败: ${err}`);
      process.exit(1);
    }
  }
}
