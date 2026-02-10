/**
 * 资源池 - Workpool Lib
 * 
 * 管理 Worker 和 Task 的核心类
 */

import type { Task, TaskStatus } from './Task';
import type { Worker, WorkerStatus, WorkerFilter, ControlSignal } from './Worker';
import type { Store } from './types';
import type { ControlBus } from '../control/ControlBus';

export interface PoolStats {
  workers: {
    total: number;
    idle: number;
    busy: number;
    paused: number;
    offline: number;
  };
  tasks: {
    total: number;
    pending: number;
    running: number;
    review: number;
    done: number;
    failed: number;
  };
}

export interface AllocationStrategy {
  selectWorker(task: Task, candidates: Worker[]): Worker | null;
}

export class LeastLoadedStrategy implements AllocationStrategy {
  selectWorker(_task: Task, candidates: Worker[]): Worker | null {
    // 选负载最低的
    return candidates.sort((a, b) => a.load - b.load)[0] || null;
  }
}

export class SkillMatchStrategy implements AllocationStrategy {
  selectWorker(task: Task, candidates: Worker[]): Worker | null {
    // 按技能匹配度排序
    const scored = candidates.map(w => {
      const matched = task.requirements.skills?.filter(s => w.skills.includes(s)) || [];
      const score = task.requirements.skills?.length 
        ? matched.length / task.requirements.skills.length 
        : 0.5;
      return { worker: w, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.worker || null;
  }
}

export class Pool {
  private store: Store;
  private controlBus?: ControlBus;
  private strategy: AllocationStrategy;

  constructor(store: Store, options?: {
    controlBus?: ControlBus;
    strategy?: AllocationStrategy;
  }) {
    this.store = store;
    this.controlBus = options?.controlBus;
    this.strategy = options?.strategy || new LeastLoadedStrategy();
  }

  // ========== Worker 管理 ==========
  registerWorker(worker: Worker): void {
    this.store.saveWorker(worker);
  }

  getWorker(id: string): Worker | null {
    return this.store.getWorker(id);
  }

  listWorkers(filter?: WorkerFilter): Worker[] {
    return this.store.listWorkers(filter);
  }

  updateWorker(worker: Worker): void {
    worker.lastHeartbeat = new Date().toISOString();
    this.store.saveWorker(worker);
  }

  heartbeat(workerId: string): void {
    const worker = this.getWorker(workerId);
    if (worker) {
      worker.lastHeartbeat = new Date().toISOString();
      this.store.saveWorker(worker);
    }
  }

  // ========== Task 管理 ==========
  submitTask(task: Task): void {
    this.store.saveTask(task);
  }

  getTask(id: string): Task | null {
    return this.store.getTask(id);
  }

  listTasks(filter?: { status?: TaskStatus | TaskStatus[]; assignee?: string }): Task[] {
    return this.store.listTasks(filter);
  }

  updateTask(task: Task): void {
    this.store.saveTask(task);
  }

  // ========== 调度核心 ==========
  allocate(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'pending') return false;

    // 找可用 worker
    const candidates = this.listWorkers({ 
      status: 'idle',
      available: true 
    }).filter(w => w.load < w.capacity);

    if (candidates.length === 0) return false;

    // 策略选择
    const selected = this.strategy.selectWorker(task, candidates);
    if (!selected) return false;

    // 分配
    task.status = 'assigned';
    task.meta.assignee = selected.id;
    task.assignedAt = new Date().toISOString();
    this.store.saveTask(task);

    // 更新 worker
    selected.load++;
    if (selected.load >= selected.capacity) {
      selected.status = 'busy';
    }
    this.store.saveWorker(selected);

    return true;
  }

  startTask(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'assigned') return false;

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    this.store.saveTask(task);

    // 更新 worker
    const worker = this.getWorker(task.meta.assignee!);
    if (worker) {
      worker.currentTask = taskId;
      worker.taskStartedAt = new Date().toISOString();
      this.store.saveWorker(worker);
    }

    return true;
  }

  completeTask(taskId: string, result?: any): boolean {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') return false;

    task.status = 'review';
    task.completedAt = new Date().toISOString();
    task.result = result;
    this.store.saveTask(task);

    // 释放 worker
    const worker = this.getWorker(task.meta.assignee!);
    if (worker) {
      worker.currentTask = undefined;
      worker.taskStartedAt = undefined;
      worker.load = Math.max(0, worker.load - 1);
      worker.status = worker.load === 0 ? 'idle' : 'busy';
      this.store.saveWorker(worker);
    }

    return true;
  }

  failTask(taskId: string, error: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;

    task.status = 'failed';
    task.error = error;
    task.completedAt = new Date().toISOString();
    this.store.saveTask(task);

    // 释放 worker
    const worker = task.meta.assignee ? this.getWorker(task.meta.assignee) : null;
    if (worker) {
      worker.currentTask = undefined;
      worker.load = Math.max(0, worker.load - 1);
      worker.status = worker.load === 0 ? 'idle' : 'busy';
      this.store.saveWorker(worker);
    }

    return true;
  }

  // ========== 全局控制 ==========
  pause(workerId?: string): void {
    if (workerId) {
      this.controlBus?.sendSignal(workerId, 'PAUSE', 'Coordinator pause');
      const worker = this.getWorker(workerId);
      if (worker) {
        worker.control.signal = 'PAUSE';
        worker.control.signalTime = new Date().toISOString();
        this.store.saveWorker(worker);
      }
    } else {
      // 暂停全部
      for (const w of this.listWorkers()) {
        this.pause(w.id);
      }
    }
  }

  resume(workerId?: string): void {
    if (workerId) {
      this.controlBus?.sendSignal(workerId, 'RESUME');
      const worker = this.getWorker(workerId);
      if (worker) {
        worker.control.signal = 'RESUME';
        worker.control.signalTime = new Date().toISOString();
        if (worker.status === 'paused') {
          worker.status = worker.load > 0 ? 'busy' : 'idle';
        }
        this.store.saveWorker(worker);
      }
    } else {
      for (const w of this.listWorkers()) {
        this.resume(w.id);
      }
    }
  }

  stop(workerId?: string): void {
    if (workerId) {
      this.controlBus?.sendSignal(workerId, 'STOP');
    } else {
      for (const w of this.listWorkers()) {
        this.stop(w.id);
      }
    }
  }

  // ========== 统计 ==========
  getStats(): PoolStats {
    const workers = this.listWorkers();
    const tasks = this.listTasks();

    return {
      workers: {
        total: workers.length,
        idle: workers.filter(w => w.status === 'idle').length,
        busy: workers.filter(w => w.status === 'busy').length,
        paused: workers.filter(w => w.status === 'paused').length,
        offline: workers.filter(w => w.status === 'offline').length,
      },
      tasks: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'pending').length,
        running: tasks.filter(t => t.status === 'running').length,
        review: tasks.filter(t => t.status === 'review').length,
        done: tasks.filter(t => t.status === 'done').length,
        failed: tasks.filter(t => t.status === 'failed').length,
      }
    };
  }
}
