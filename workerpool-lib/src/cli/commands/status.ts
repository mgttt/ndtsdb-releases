// ============================================================
// status command - 查看进程状态
// ============================================================

import type { Daemon } from '../../daemon/Daemon';
import { formatDuration, formatBytes } from '../table';

export async function statusCommand(
  args: string[],
  _options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  const name = args[0];

  try {
    if (name) {
      // 单个进程详情
      const result = await daemon.sendCommand({
        action: 'status',
        payload: { name },
      });

      if (!result.ok || !result.data) {
        console.error(`[wp] 进程不存在: ${name}`);
        process.exit(1);
      }

      const p = result.data;
      console.log(`
进程: ${p.name}
状态: ${p.status}
PID: ${p.pid || '-'}
重启次数: ${p.restarts || 0}
运行时间: ${p.startedAt ? formatDuration(Date.now() - new Date(p.startedAt).getTime()) : '-'}
CPU: ${p.cpu !== undefined ? `${p.cpu.toFixed(1)}%` : '-'}
内存: ${p.memory !== undefined ? formatBytes(p.memory) : '-'}
脚本: ${p.config?.script || '-'}
工作目录: ${p.config?.cwd || '-'}
自动重启: ${p.config?.autorestart !== false ? '是' : '否'}
`);
    } else {
      // 总览 - 所有进程统计
      const result = await daemon.sendCommand({ action: 'list', payload: {} });
      if (!result.ok || !Array.isArray(result.data)) {
        console.error('[wp] 获取进程列表失败');
        process.exit(1);
      }

      const processes = result.data;
      const online = processes.filter((p: any) => p.status === 'online').length;
      const stopped = processes.filter((p: any) => p.status === 'stopped').length;
      const errored = processes.filter((p: any) => p.status === 'errored').length;

      console.log(`
总进程数: ${processes.length}
运行中: ${online}
已停止: ${stopped}
错误: ${errored}
`);
    }
  } catch (err) {
    console.error(`[wp] 状态获取失败: ${err}`);
    process.exit(1);
  }
}
