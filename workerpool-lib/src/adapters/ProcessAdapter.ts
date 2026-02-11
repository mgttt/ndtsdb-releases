// ============================================================
// ProcessAdapter - workpool-lib Adapter 接口实现
//
// 将 ProcessManager 适配到 core/types.ts 的 Adapter 抽象
// 允许 Engine 以 Resource/Work 方式调度进程资源
// ============================================================

import type { Adapter, ControlSignal, Resource } from '../core/types';
import { ProcessManager } from '../process/ProcessManager';
import type { ProcessConfig, ProcessState } from '../process/ProcessState';

export interface ProcessAdapterOptions {
  baseDir?: string;
}

export class ProcessAdapter implements Adapter<ProcessConfig, ProcessState> {
  readonly name = 'process';

  private pm: ProcessManager;

  constructor(options?: ProcessAdapterOptions) {
    this.pm = new ProcessManager({ baseDir: options?.baseDir });
  }

  async init(resource: Resource<ProcessConfig, ProcessState>): Promise<void> {
    // init 视为 start
    await this.pm.start(resource.spec);
  }

  async getState(resourceId: string, _spec: ProcessConfig): Promise<ProcessState> {
    const state = this.pm.getState(resourceId);
    if (!state) {
      throw new Error(`process not found: ${resourceId}`);
    }
    return state;
  }

  async healthCheck(resourceId: string, _spec: ProcessConfig): Promise<boolean> {
    const state = this.pm.getState(resourceId);
    if (!state || !state.pid) return false;
    try {
      process.kill(state.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async control(resourceId: string, _spec: ProcessConfig, signal: ControlSignal): Promise<void> {
    switch (signal) {
      case 'STOP':
        await this.pm.stop(resourceId, 'SIGTERM');
        return;
      case 'KILL':
        await this.pm.stop(resourceId, 'SIGKILL');
        return;
      case 'PAUSE':
        this.pm.signal(resourceId, 'SIGSTOP');
        return;
      case 'RESUME':
        this.pm.signal(resourceId, 'SIGCONT');
        return;
      default:
        return;
    }
  }

  async destroy(resourceId: string, _spec: ProcessConfig): Promise<void> {
    await this.pm.delete(resourceId);
  }

  /**
   * 获取内部 ProcessManager（daemon 会用到）
   */
  getProcessManager(): ProcessManager {
    return this.pm;
  }
}

export default ProcessAdapter;
