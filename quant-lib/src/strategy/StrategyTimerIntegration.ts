import { StrategySpec } from './StrategyPool';
import { TimerScheduler, TimerConfig } from '../scheduler/TimerScheduler';

/**
 * Strategy + Timer 集成
 * 
 * 为策略自动生成定时任务
 */
export class StrategyTimerIntegration {
  private scheduler: TimerScheduler;
  
  constructor(options?: { 
    scheduler?: TimerScheduler;
  }) {
    this.scheduler = options?.scheduler ?? new TimerScheduler();
  }
  
  /**
   * 将策略注册为定时任务
   * 
   * 如果策略是 interval/cron 模式，自动创建 systemd timer
   */
  async scheduleStrategy(
    strategy: StrategySpec,
    options?: {
      workingDir?: string;
      notifyOnError?: boolean;
      notifyOnSuccess?: boolean;
    }
  ): Promise<void> {
    if (strategy.schedule === 'manual') {
      console.log(`ℹ️  Strategy ${strategy.id} is manual, skipping timer`);
      return;
    }
    
    // 构建定时任务配置
    const timerConfig: TimerConfig = {
      name: `strategy-${strategy.id}`,
      description: `Execute strategy: ${strategy.name}`,
      
      schedule: strategy.schedule === 'interval' 
        ? {
            type: 'interval',
            minutes: strategy.intervalMs 
              ? Math.floor(strategy.intervalMs / 60000) 
              : 30,
          }
        : {
            type: 'calendar',
            calendar: strategy.cronExpr ?? '*:0/30',
          },
      
      command: this.buildCommand(strategy),
      workingDir: options?.workingDir,
      
      notify: {
        telegram: options?.notifyOnError !== false,
        onSuccess: options?.notifyOnSuccess ?? false,
      },
      
      options: {
        timeoutSeconds: Math.ceil(strategy.script.timeoutMs / 1000) + 30,
        preventOverlap: true,
        persistent: true,
      },
    };
    
    await this.scheduler.createTimer(timerConfig);
    
    console.log(`⏰ Strategy scheduled: ${strategy.id}`);
  }
  
  /**
   * 取消策略的定时任务
   */
  async unscheduleStrategy(strategyId: string): Promise<void> {
    await this.scheduler.removeTimer(`strategy-${strategyId}`);
  }
  
  /**
   * 查看策略定时任务状态
   */
  async getStrategyStatus(strategyId: string): Promise<any> {
    const timers = await this.scheduler.listTimers();
    return timers.find(t => t.name === `strategy-${strategyId}`);
  }
  
  /**
   * 手动触发策略执行
   */
  async triggerStrategy(strategyId: string): Promise<void> {
    await this.scheduler.triggerNow(`strategy-${strategyId}`);
  }
  
  /**
   * 查看策略执行日志
   */
  async viewStrategyLogs(strategyId: string, lines: number = 50): Promise<string> {
    return this.scheduler.viewLogs(`strategy-${strategyId}`, lines);
  }
  
  private buildCommand(strategy: StrategySpec): string {
    // 生成执行命令
    // 假设有一个策略执行脚本
    return `bun run-strategy.ts execute ${strategy.id}`;
  }
}
