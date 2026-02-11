// ============================================================
// save command - 导出配置到 wp.config.ts
// ============================================================

import type { Daemon } from '../../daemon/Daemon';
import { writeFileSync } from 'fs';

export async function saveCommand(
  _args: string[],
  _options: Record<string, string | boolean>,
  daemon: Daemon
): Promise<void> {
  try {
    const result = await daemon.sendCommand({ action: 'list', payload: {} });
    if (!result.ok || !Array.isArray(result.data)) {
      console.error('[wp] 获取进程列表失败');
      process.exit(1);
    }

    const processes = result.data;
    
    // 生成配置内容
    const configs = processes.map((p: any) => {
      const cfg = p.config;
      return `  {
    name: "${cfg.name}",
    script: "${cfg.script}",
    interpreter: "${cfg.interpreter || 'auto'}",${cfg.cwd ? `\n    cwd: "${cfg.cwd}",` : ''}${cfg.maxRestarts !== undefined ? `\n    maxRestarts: ${cfg.maxRestarts},` : ''}${cfg.autorestart === false ? `\n    autorestart: false,` : ''}${cfg.maxMemory ? `\n    maxMemory: ${cfg.maxMemory},` : ''}${cfg.group ? `\n    group: "${cfg.group}",` : ''}
  }`;
    }).join(',\n');

    const content = `import type { ProcessConfig } from '@moltbaby/workpool-lib';

export default {
  apps: [
${configs}
  ],
} satisfies { apps: ProcessConfig[] };
`;

    writeFileSync('wp.config.ts', content);
    console.log(`[wp] 配置已保存到 wp.config.ts (${processes.length} 个进程)`);
  } catch (err) {
    console.error(`[wp] 保存失败: ${err}`);
    process.exit(1);
  }
}
