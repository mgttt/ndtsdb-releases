// ============================================================
// load command - 从配置文件批量启动
// ============================================================

import type { Daemon } from '../../daemon/Daemon';
import type { ProcessConfig } from '../../process/ProcessState';

export async function loadCommand(
  args: string[],
  _options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  const configFile = args[0] || 'wp.config.ts';
  
  console.log(`[wp] 从 ${configFile} 加载配置...`);
  
  try {
    // 动态导入配置
    const configModule = await import(configFile);
    const config = configModule.default || configModule;
    
    if (!config.apps || !Array.isArray(config.apps)) {
      console.error('[wp] 配置文件格式错误: 缺少 apps 数组');
      process.exit(1);
    }

    console.log(`[wp] 发现 ${config.apps.length} 个进程配置`);

    for (const appConfig of config.apps as ProcessConfig[]) {
      try {
        const result = await daemon.sendCommand({
          action: 'start',
          payload: { config: appConfig },
        });

        if (result.ok) {
          console.log(`[wp] 已启动: ${appConfig.name}`);
        } else {
          console.error(`[wp] 启动失败: ${appConfig.name} - ${result.error}`);
        }
      } catch (err) {
        console.error(`[wp] 启动失败: ${appConfig.name}`, err);
      }
    }

    console.log('[wp] 批量启动完成');
  } catch (err) {
    console.error(`[wp] 加载失败: ${err}`);
    process.exit(1);
  }
}
