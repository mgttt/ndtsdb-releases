import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);

/**
 * 定时任务配置
 */
export interface TimerConfig {
  name: string;              // 任务名称 (唯一标识)
  description?: string;      // 描述
  schedule: {
    type: 'interval' | 'calendar';
    // interval: 每 N 分钟/小时
    minutes?: number;
    hours?: number;
    // calendar: systemd OnCalendar 格式 (如 "*:0/30" 每30分钟)
    calendar?: string;
  };
  command: string;           // 执行的命令
  workingDir?: string;       // 工作目录
  env?: Record<string, string>; // 环境变量
  
  // 通知配置
  notify?: {
    telegram?: boolean;      // 失败时 Telegram 通知
    onSuccess?: boolean;     // 成功也通知
  };
  
  // 执行选项
  options?: {
    timeoutSeconds?: number; // 超时时间
    preventOverlap?: boolean; // 使用 flock 防止重叠执行
    persistent?: boolean;    // 系统重启后补跑错过的任务
  };
}

/**
 * 定时任务状态
 */
export interface TimerStatus {
  name: string;
  enabled: boolean;
  active: boolean;
  lastRun: string | null;
  nextRun: string | null;
  schedule: string;
}

/**
 * Systemd Timer 管理器
 * 
 * 封装 systemd user timers，提供程序化接口
 */
export class TimerScheduler {
  private userConfigDir: string;
  private timersDir: string;
  private scriptsDir: string;
  
  constructor(options?: { 
    userConfigDir?: string;
    timersDir?: string;
    scriptsDir?: string;
  }) {
    this.userConfigDir = options?.userConfigDir 
      ?? join(homedir(), '.config/systemd/user');
    this.timersDir = options?.timersDir 
      ?? join(homedir(), 'moltbaby/devops/timers');
    this.scriptsDir = options?.scriptsDir 
      ?? join(homedir(), 'moltbaby/quant-lab/scripts');
    
    // 确保目录存在
    mkdirSync(this.userConfigDir, { recursive: true });
    mkdirSync(this.timersDir, { recursive: true });
  }
  
  /**
   * 创建/更新定时任务
   */
  async createTimer(config: TimerConfig): Promise<void> {
    const fullName = `quantlab-${config.name}`;
    
    // 1. 创建 wrapper script
    const scriptPath = await this.createWrapperScript(config);
    
    // 2. 创建 service 文件
    await this.createServiceFile(fullName, config, scriptPath);
    
    // 3. 创建 timer 文件
    await this.createTimerFile(fullName, config);
    
    // 4. 重载并启动
    await this.reloadDaemon();
    await this.enableTimer(fullName);
    
    console.log(`✅ Timer created: ${config.name}`);
  }
  
  /**
   * 删除定时任务
   */
  async removeTimer(name: string): Promise<void> {
    const fullName = `quantlab-${name}`;
    
    // 停止并禁用
    try {
      await execAsync(`systemctl --user stop ${fullName}.timer`);
      await execAsync(`systemctl --user disable ${fullName}.timer`);
    } catch {}
    
    // 删除文件
    const servicePath = join(this.userConfigDir, `${fullName}.service`);
    const timerPath = join(this.userConfigDir, `${fullName}.timer`);
    const scriptPath = join(this.timersDir, `${fullName}.sh`);
    
    if (existsSync(servicePath)) require('fs').unlinkSync(servicePath);
    if (existsSync(timerPath)) require('fs').unlinkSync(timerPath);
    if (existsSync(scriptPath)) require('fs').unlinkSync(scriptPath);
    
    await this.reloadDaemon();
    
    console.log(`🗑️  Timer removed: ${name}`);
  }
  
  /**
   * 列出所有定时任务
   */
  async listTimers(): Promise<TimerStatus[]> {
    try {
      const { stdout } = await execAsync('systemctl --user list-timers --all --no-pager');
      
      const lines = stdout.split('\n').slice(1, -2); // 去掉表头表尾
      const timers: TimerStatus[] = [];
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[4]?.startsWith('quantlab-')) {
          timers.push({
            name: parts[4].replace('quantlab-', '').replace('.timer', ''),
            enabled: true,
            active: parts[2] !== 'n/a',
            lastRun: parts[1] === 'n/a' ? null : parts[1] + ' ' + parts[2],
            nextRun: parts[3] === 'n/a' ? null : parts[3] + ' ' + parts[4],
            schedule: parts[0],
          });
        }
      }
      
      return timers;
    } catch {
      return [];
    }
  }
  
  /**
   * 立即触发一次任务
   */
  async triggerNow(name: string): Promise<void> {
    const fullName = `quantlab-${name}`;
    await execAsync(`systemctl --user start ${fullName}.service`);
    console.log(`▶️  Triggered: ${name}`);
  }
  
  /**
   * 查看任务日志
   */
  async viewLogs(name: string, lines: number = 50): Promise<string> {
    const fullName = `quantlab-${name}`;
    const { stdout } = await execAsync(
      `journalctl --user -u ${fullName}.service --no-pager -n ${lines}`
    );
    return stdout;
  }
  
  // ===== 私有方法 =====
  
  private async createWrapperScript(config: TimerConfig): Promise<string> {
    const fullName = `quantlab-${config.name}`;
    const scriptPath = join(this.timersDir, `${fullName}.sh`);
    
    // 构建 schedule 表达式
    let calendarExpr: string;
    if (config.schedule.type === 'interval') {
      if (config.schedule.minutes) {
        calendarExpr = `*:0/${config.schedule.minutes}`;
      } else if (config.schedule.hours) {
        calendarExpr = `0/${config.schedule.hours}:00`;
      } else {
        calendarExpr = '*:0/30'; // 默认30分钟
      }
    } else {
      calendarExpr = config.schedule.calendar ?? '*:0/30';
    }
    
    // 构建命令
    const workingDir = config.workingDir ?? this.scriptsDir;
    const envExports = Object.entries(config.env ?? {})
      .map(([k, v]) => `export ${k}="${v}"`)
      .join('\n');
    
    const timeout = config.options?.timeoutSeconds ?? 300;
    const flockCmd = config.options?.preventOverlay !== false 
      ? `flock -n /tmp/${fullName}.lock -c '
    set -euo pipefail
    cd "${workingDir}"
    ${envExports}
    timeout ${timeout} ${config.command}
' || echo "Another instance is running"`
      : `cd "${workingDir}"
${envExports}
timeout ${timeout} ${config.command}`;
    
    // 通知逻辑
    const notifyLogic = config.notify?.telegram ? `
# 通知
if [ $? -eq 0 ]; then
    ${config.notify.onSuccess ? `
    /usr/local/bin/openclaw message send \\
        --channel telegram \\
        --target telegram:1949411866 \\
        --message "✅ ${config.name} 执行成功"
    ` : ''}
else
    /usr/local/bin/openclaw message send \\
        --channel telegram \\
        --target telegram:1949411866 \\
        --message "❌ ${config.name} 执行失败，请检查日志"
fi
` : '';
    
    const script = `#!/bin/bash
# ${config.description ?? config.name}
# Generated by quant-lib TimerScheduler
# Schedule: ${calendarExpr}

set -euo pipefail

${flockCmd}
${notifyLogic}
`;
    
    writeFileSync(scriptPath, script);
    await execAsync(`chmod +x ${scriptPath}`);
    
    return scriptPath;
  }
  
  private async createServiceFile(
    fullName: string,
    config: TimerConfig,
    scriptPath: string
  ): Promise<void> {
    const servicePath = join(this.userConfigDir, `${fullName}.service`);
    
    const service = `[Unit]
Description=${config.description ?? config.name}
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${scriptPath}
StandardOutput=journal
StandardError=journal
`;
    
    writeFileSync(servicePath, service);
  }
  
  private async createTimerFile(fullName: string, config: TimerConfig): Promise<void> {
    const timerPath = join(this.userConfigDir, `${fullName}.timer`);
    
    // 构建 OnCalendar
    let onCalendar: string;
    if (config.schedule.type === 'interval') {
      if (config.schedule.minutes) {
        onCalendar = `*:0/${config.schedule.minutes}`;
      } else if (config.schedule.hours) {
        onCalendar = `0/${config.schedule.hours}:00`;
      } else {
        onCalendar = '*:0/30';
      }
    } else {
      onCalendar = config.schedule.calendar ?? '*:0/30';
    }
    
    const timer = `[Unit]
Description=${config.description ?? config.name} timer

[Timer]
OnCalendar=${onCalendar}
Persistent=${config.options?.persistent !== false ? 'true' : 'false'}

[Install]
WantedBy=timers.target
`;
    
    writeFileSync(timerPath, timer);
  }
  
  private async reloadDaemon(): Promise<void> {
    await execAsync('systemctl --user daemon-reload');
  }
  
  private async enableTimer(fullName: string): Promise<void> {
    await execAsync(`systemctl --user enable --now ${fullName}.timer`);
  }
}
