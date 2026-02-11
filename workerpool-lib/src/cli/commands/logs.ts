// ============================================================
// logs command - 查看日志
// ============================================================

import type { Daemon } from '../../daemon/Daemon';

export async function logsCommand(
  args: string[],
  options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error('错误: 请指定进程名');
    console.error('用法: wp logs <name> [options]');
    process.exit(1);
  }

  const lines = options.lines ? parseInt(options.lines as string, 10) : 50;
  const follow = options.f === true || options.follow === true;
  const type = options.err ? 'err' : 'out';

  try {
    if (follow) {
      // follow 模式 - 持续输出新日志
      console.log(`[wp] 跟踪日志: ${name} (按 Ctrl+C 退出)`);
      
      // 先显示已有日志
      const result = await daemon.sendCommand({
        action: 'logs',
        payload: { name, lines: 10, type },
      });
      
      if (result.ok && Array.isArray(result.data)) {
        for (const line of result.data) {
          console.log(line);
        }
      }

      // 持续 poll 新日志
      let lastSize = 0;
      while (true) {
        await new Promise(r => setTimeout(r, 500));
        
        const newResult = await daemon.sendCommand({
          action: 'logs',
          payload: { name, lines: 100, type },
        });
        
        if (newResult.ok && Array.isArray(newResult.data)) {
          const newLines = newResult.data.slice(lastSize);
          for (const line of newLines) {
            console.log(line);
          }
          lastSize = newResult.data.length;
        }
      }
    } else {
      // 普通模式 - 显示最后 N 行
      const result = await daemon.sendCommand({
        action: 'logs',
        payload: { name, lines, type },
      });

      if (result.ok && Array.isArray(result.data)) {
        for (const line of result.data) {
          console.log(line);
        }
      } else {
        console.error(`[wp] 获取日志失败: ${result.error}`);
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(`[wp] 日志获取失败: ${err}`);
    process.exit(1);
  }
}
