// ============================================================
// monit command - 实时监控面板
// ============================================================

import type { Daemon } from '../../daemon/Daemon';
import { Table, formatDuration, formatBytes } from '../table';

export async function monitCommand(
  _args: string[],
  _options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  console.clear();
  console.log('wp monit - 按 Ctrl+C 退出\n');

  const render = async () => {
    try {
      const result = await daemon.sendCommand({ action: 'list', payload: {} });
      if (!result.ok || !Array.isArray(result.data)) {
        console.log('[wp] 获取进程列表失败');
        return;
      }

      const processes = result.data;

      // 清屏并移动光标到顶部
      process.stdout.write('\x1B[2J\x1B[H');
      console.log('wp monit - 按 Ctrl+C 退出\n');

      if (processes.length === 0) {
        console.log('没有管理的进程');
        return;
      }

      const table = new Table([
        { key: 'name', header: 'name', width: 20 },
        { key: 'status', header: 'status', width: 10 },
        { key: 'pid', header: 'pid', width: 8 },
        { key: 'restarts', header: 'restarts', width: 10 },
        { key: 'uptime', header: 'uptime', width: 10 },
        { key: 'cpu', header: 'cpu', width: 8 },
        { key: 'memory', header: 'memory', width: 10 },
        { key: 'group', header: 'group', width: 12 },
      ]);

      for (const p of processes) {
        const uptime = p.startedAt
          ? formatDuration(Date.now() - new Date(p.startedAt).getTime())
          : '-';

        table.addRow({
          name: p.name,
          status: p.status,
          pid: p.pid ? String(p.pid) : '-',
          restarts: String(p.restarts || 0),
          uptime,
          cpu: p.cpu !== undefined ? `${p.cpu.toFixed(1)}%` : '-',
          memory: p.memory !== undefined ? formatBytes(p.memory) : '-',
          group: p.config?.group || '-',
        });
      }

      console.log(table.render());
      console.log(`\n共 ${processes.length} 个进程 | ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.log('[wp] 刷新失败:', err);
    }
  };

  // 首次渲染
  await render();

  // 每秒刷新
  const interval = setInterval(render, 1000);

  // 处理退出
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n[wp] monit 已退出');
    process.exit(0);
  });

  // 保持运行
  await new Promise(() => {});
}
