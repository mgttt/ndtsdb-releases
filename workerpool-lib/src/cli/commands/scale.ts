// ============================================================
// scale command - 扩缩容实例数
// ============================================================

import type { Daemon } from '../../daemon/Daemon';

export async function scaleCommand(
  args: string[],
  _options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  const name = args[0];
  const numStr = args[1];

  if (!name || !numStr) {
    console.error('错误: 请指定进程名和目标实例数');
    console.error('用法: wp scale <name> <num>');
    process.exit(1);
  }

  const targetNum = parseInt(numStr, 10);
  if (isNaN(targetNum) || targetNum < 0) {
    console.error('错误: 实例数必须是正整数');
    process.exit(1);
  }

  // 获取基础进程名（去掉 -N 后缀）
  const baseName = name.replace(/-\d+$/, '');

  // 获取当前运行的实例
  const list = await daemon.sendCommand({ action: 'list', payload: {} });
  if (!list.ok || !Array.isArray(list.data)) {
    console.error('[wp] 获取进程列表失败');
    process.exit(1);
  }

  const instances = list.data.filter((p: any) => 
    p.name === baseName || p.name.startsWith(`${baseName}-`)
  );

  const currentNum = instances.length;

  if (targetNum > currentNum) {
    // 扩容
    console.log(`[wp] 扩容: ${baseName} ${currentNum} -> ${targetNum}`);
    
    // 获取基础配置
    const baseProc = instances.find((p: any) => p.name === baseName) || instances[0];
    if (!baseProc) {
      console.error(`[wp] 未找到基础进程: ${baseName}`);
      process.exit(1);
    }

    for (let i = currentNum; i < targetNum; i++) {
      const instanceName = i === 0 ? baseName : `${baseName}-${i}`;
      const config = { ...baseProc.config, name: instanceName };
      
      try {
        await daemon.sendCommand({
          action: 'start',
          payload: { config },
        });
        console.log(`[wp] 已启动: ${instanceName}`);
      } catch (err) {
        console.error(`[wp] 启动失败: ${instanceName}`, err);
      }
    }
  } else if (targetNum < currentNum) {
    // 缩容
    console.log(`[wp] 缩容: ${baseName} ${currentNum} -> ${targetNum}`);
    
    // 按序号降序，先停高序号
    const sorted = instances
      .map((p: any) => ({
        ...p,
        index: p.name === baseName ? 0 : parseInt(p.name.split('-').pop()!, 10),
      }))
      .sort((a: any, b: any) => b.index - a.index);

    for (let i = currentNum - 1; i >= targetNum; i--) {
      const proc = sorted.find((p: any) => p.index === i);
      if (proc) {
        try {
          await daemon.sendCommand({
            action: 'stop',
            payload: { name: proc.name },
          });
          console.log(`[wp] 已停止: ${proc.name}`);
        } catch (err) {
          console.error(`[wp] 停止失败: ${proc.name}`, err);
        }
      }
    }
  } else {
    console.log(`[wp] ${baseName} 已经是 ${targetNum} 个实例`);
  }
}
