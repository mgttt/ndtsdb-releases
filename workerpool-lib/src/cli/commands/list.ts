// ============================================================
// list command - 列出所有进程
// ============================================================

import type { Daemon } from '../../daemon/Daemon';
import { Table, formatDuration, formatBytes } from '../table';

export async function listCommand(
  _args: string[],
  options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  try {
    const result = await daemon.sendCommand({ action: 'list', payload: {} });
    if (!result.ok || !Array.isArray(result.data)) {
      console.error('[wp] 获取进程列表失败');
      process.exit(1);
    }

    let processes = result.data;
    
    // 按 group 过滤
    if (options.group) {
      const group = options.group as string;
      processes = processes.filter((p: any) => p.config?.group === group);
    }
    if (processes.length === 0) {
      console.log('[wp] 没有管理的进程');
      return;
    }

    const table = new Table([
      { key: 'id', header: 'id', width: 4 },
      { key: 'name', header: 'name', width: 20 },
      { key: 'status', header: 'status', width: 10 },
      { key: 'pid', header: 'pid', width: 8 },
      { key: 'restarts', header: 'restarts', width: 10 },
      { key: 'uptime', header: 'uptime', width: 10 },
      { key: 'cpu', header: 'cpu', width: 8 },
      { key: 'memory', header: 'memory', width: 10 },
    ]);

    processes.forEach((p: any, idx: number) => {
      const uptime = p.startedAt 
        ? formatDuration(Date.now() - new Date(p.startedAt).getTime())
        : '-';
      
      table.addRow({
        id: String(idx),
        name: p.name,
        status: p.status,
        pid: p.pid ? String(p.pid) : '-',
        restarts: String(p.restarts || 0),
        uptime,
        cpu: p.cpu !== undefined ? `${p.cpu.toFixed(1)}%` : '-',
        memory: p.memory !== undefined ? formatBytes(p.memory) : '-',
      });
    });

    console.log(table.render());
  } catch (err) {
    console.error(`[wp] 列表获取失败: ${err}`);
    process.exit(1);
  }
}
