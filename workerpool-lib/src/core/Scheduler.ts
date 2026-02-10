/**
 * 调度器 - Workpool Lib
 * 
 * 自动调度循环 + 超时检测
 */

import type { Pool } from './Pool';
import type { Task } from './Task';

export interface SchedulerConfig {
  intervalMs: number;           // 调度间隔
  timeoutMinutes: number;       // 任务超时时间
  maxRetries: number;           // 最大重试次数
  heartbeatTimeoutMs: number;   // 心跳超时
}

export class Scheduler {
  private pool: Pool;
  private config: SchedulerConfig;
  private timer: any = null;
  private running = false;

  constructor(pool: Pool, config?: Partial<SchedulerConfig>) {
    this.pool = pool;
    this.config = {
      intervalMs: 30000,
      timeoutMinutes: 30,
      maxRetries: 3,
      heartbeatTimeoutMs: 60000,
      ...config
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    
    // 立即执行一次
    this.tick();
    
    // 定时循环
    this.timer = setInterval(() => this.tick(), this.config.intervalMs);
    
    console.log(`[Scheduler] Started, interval: ${this.config.intervalMs}ms`);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped');
  }

  async tick(): Promise<void> {
    const start = Date.now();
    
    try {
      // 1. 分配待处理任务
      await this.allocatePendingTasks();
      
      // 2. 检查超时任务
      await this.checkTimeouts();
      
      // 3. 检查离线 worker
      await this.checkHeartbeats();
      
    } catch (e) {
      console.error('[Scheduler] Tick error:', e);
    }
    
    const duration = Date.now() - start;
    console.log(`[Scheduler] Tick completed in ${duration}ms`);
  }

  private async allocatePendingTasks(): Promise<void> {
    const pending = this.pool.listTasks({ status: 'pending' });
    
    // 按优先级排序
    pending.sort((a, b) => b.priority - a.priority);
    
    for (const task of pending) {
      const success = this.pool.allocate(task.id);
      if (success) {
        console.log(`[Scheduler] Allocated task ${task.id}`);
      } else {
        // 无可用 worker，跳出（优先级低的更不用试了）
        break;
      }
    }
  }

  private async checkTimeouts(): Promise<void> {
    const now = new Date();
    const running = this.pool.listTasks({ status: 'running' });
    
    for (const task of running) {
      if (!task.startedAt) continue;
      
      const started = new Date(task.startedAt);
      const minutesRunning = (now.getTime() - started.getTime()) / 60000;
      
      if (minutesRunning > this.config.timeoutMinutes) {
        console.log(`[Scheduler] Task ${task.id} timeout (${Math.round(minutesRunning)}min)`);
        
        // 标记超时
        task.status = 'timeout';
        this.pool.updateTask(task);
        
        // 释放 worker
        const worker = task.meta.assignee ? this.pool.getWorker(task.meta.assignee) : null;
        if (worker) {
          worker.load = Math.max(0, worker.load - 1);
          worker.currentTask = undefined;
          this.pool.updateWorker(worker);
        }
        
        // 重试逻辑
        if (task.retryCount < this.config.maxRetries) {
          task.retryCount++;
          task.status = 'pending';
          task.meta.assignee = undefined;
          this.pool.updateTask(task);
          console.log(`[Scheduler] Task ${task.id} retry #${task.retryCount}`);
        }
      }
    }
  }

  private async checkHeartbeats(): Promise<void> {
    const now = new Date();
    const workers = this.pool.listWorkers();
    
    for (const worker of workers) {
      const lastBeat = new Date(worker.lastHeartbeat);
      const msSinceBeat = now.getTime() - lastBeat.getTime();
      
      if (msSinceBeat > this.config.heartbeatTimeoutMs) {
        if (worker.status !== 'offline') {
          console.log(`[Scheduler] Worker ${worker.id} marked offline (no heartbeat)`);
          worker.status = 'offline';
          this.pool.updateWorker(worker);
          
          // 回收其任务
          if (worker.currentTask) {
            const task = this.pool.getTask(worker.currentTask);
            if (task && task.status === 'running') {
              task.status = 'pending';
              task.meta.assignee = undefined;
              this.pool.updateTask(task);
              console.log(`[Scheduler] Reclaimed task ${task.id} from offline worker`);
            }
          }
        }
      }
    }
  }
}
