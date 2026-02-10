/**
 * Engine - 资源编排引擎
 * 
 * 核心功能：
 * 1. 资源注册与管理
 * 2. 工作提交与分配
 * 3. 调度循环
 * 4. 全局控制
 */

import type { 
  Resource, Work, Adapter, ControlSignal, Store, AllocationStrategy
} from '../core/types';

// 默认策略实现（内联以避免循环导入）
class LeastLoadedStrategy implements AllocationStrategy {
  readonly name = 'least-loaded';
  select<R extends Resource, W extends Work>(work: W, candidates: R[]): R | null {
    return candidates.sort((a, b) => a.load - b.load)[0] || null;
  }
}

// FileLock 导入（从独立文件）
import { FileLock } from '../lock/FileLock';

export interface EngineConfig {
  store: Store;
  strategy?: AllocationStrategy;
  adapters?: Map<string, Adapter>;
  scheduler?: {
    intervalMs: number;
    maxRetries: number;
    defaultTimeoutMinutes: number;
    heartbeatTimeoutMs: number;
  };
  lock?: {
    name?: string;
    timeoutMs?: number;
    enabled?: boolean;
  };
}

export interface EngineStats {
  resources: {
    total: number;
    idle: number;
    busy: number;
    paused: number;
    offline: number;
  };
  works: {
    total: number;
    pending: number;
    running: number;
    completed: number;
  };
}

/**
 * 创建资源
 */
export function createResource<Spec, State>(
  id: string,
  spec: Spec,
  capabilities: string[],
  capacity: number = 1
): Resource<Spec, State> {
  return {
    id,
    spec,
    capabilities,
    capacity,
    load: 0,
    state: {
      status: 'idle',
      data: {} as State,
      since: new Date().toISOString(),
    },
    meta: {
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    },
  };
}

/**
 * 创建工作
 */
export function createWork<Payload, Result>(
  id: string,
  payload: Payload,
  capabilities: string[],
  priority: number = 50
): Work<Payload, Result> {
  return {
    id,
    payload,
    requirements: {
      capabilities,
    },
    priority,
    timeoutMinutes: 30,
    lifecycle: {
      created: new Date().toISOString(),
    },
    result: {
      status: 'pending',
      retryCount: 0,
    },
  };
}

/**
 * Engine 类
 */
export class Engine {
  private store: Store;
  private strategy: AllocationStrategy;
  private config: Required<EngineConfig['scheduler']> & { lock: NonNullable<EngineConfig['lock']> };
  private running = false;

  constructor(config: EngineConfig) {
    this.store = config.store;
    this.strategy = config.strategy || new LeastLoadedStrategy();
    this.config = {
      intervalMs: 30000,
      maxRetries: 3,
      defaultTimeoutMinutes: 30,
      heartbeatTimeoutMs: 120000,
      lock: {
        name: 'scheduler',
        timeoutMs: 300000,
        enabled: true,
      },
      ...config.scheduler,
      lock: {
        ...config.lock,
        enabled: config.lock?.enabled !== false,
      },
    };
  }

  /**
   * 注册资源
   */
  async register<R extends Resource>(resource: R): Promise<void> {
    await this.store.saveResource(resource);
  }

  /**
   * 按路径注册资源（树状功能）
   */
  async registerResourceAtPath<R extends Resource>(path: string, resource: R): Promise<void> {
    resource.path = path;
    await this.store.saveResource(resource);
  }

  /**
   * 注销资源
   */
  async unregister(id: string): Promise<void> {
    await this.store.deleteResource(id);
  }

  /**
   * 提交工作
   */
  async submit<Payload, Result>(
    id: string,
    payload: Payload,
    requirements: { capabilities: string[]; minCapacity?: number }
  ): Promise<void> {
    const work = createWork<Payload, Result>(id, payload, requirements.capabilities);
    await this.store.saveWork(work);
  }

  /**
   * 根据路径模式调度工作
   */
  async scheduleWorkWithPath<Payload>(
    id: string,
    payload: Payload,
    requirements: { capabilities: string[]; path: string; minCapacity?: number },
    priority: number = 50
  ): Promise<boolean> {
    // 根据路径模式查找匹配的 workers
    const matchingWorkers = await this.findByPath(requirements.path);
    
    if (matchingWorkers.length === 0) {
      console.warn(`[Engine] No workers found for path pattern: ${requirements.path}`);
      return false;
    }

    // 找到可用的 worker (状态为 idle)
    const availableWorkers = matchingWorkers.filter(
      w => w.state.status === 'idle' && w.load < w.capacity
    );

    if (availableWorkers.length === 0) {
      console.warn(`[Engine] No available workers for path pattern: ${requirements.path}`);
      return false;
    }

    // 选择负载最低的 worker
    const selectedWorker = availableWorkers.sort((a, b) => a.load - b.load)[0];

    // 创建工作并直接分配给选定的 worker
    const work = createWork<Payload, any>(id, payload, requirements.capabilities);
    work.priority = priority;
    work.lifecycle.assigned = {
      resourceId: selectedWorker.id,
      at: new Date().toISOString(),
    };
    
    await this.store.saveWork(work);

    console.log(`[Engine] Work ${id} assigned to worker ${selectedWorker.id} at ${selectedWorker.path || '/'}`);
    return true;
  }

  /**
   * 获取分配给指定资源的待处理任务
   */
  async getPendingWorkForResource(resourceId: string): Promise<Work[]> {
    const allWorks = await this.store.listWorks();
    return allWorks.filter(w => {
      // 检查是否已分配给该资源且未开始执行
      const isAssigned = w.lifecycle.assigned?.resourceId === resourceId;
      const notStarted = !w.lifecycle.started;
      const notCompleted = !w.lifecycle.completed;
      return isAssigned && notStarted && notCompleted;
    });
  }

  /**
   * Worker 领取任务开始执行
   */
  async claimWork(workId: string, resourceId: string): Promise<boolean> {
    const work = await this.store.getWork(workId);
    if (!work) return false;
    
    // 检查是否已分配给该资源
    if (work.lifecycle.assigned?.resourceId !== resourceId) {
      return false;
    }
    
    // 检查是否已被领取
    if (work.lifecycle.started) {
      return false;
    }
    
    // 更新状态为运行中
    work.lifecycle.started = new Date().toISOString();
    await this.store.saveWork(work);
    
    // 更新资源状态
    const resource = await this.store.getResource(resourceId);
    if (resource) {
      resource.state.status = 'busy';
      resource.state.data = { ...resource.state.data, currentWork: workId };
      resource.load = (resource.load || 0) + 1;
      await this.store.saveResource(resource);
    }
    
    return true;
  }

  /**
   * 完成任务
   */
  async completeWork(workId: string, result: { status: 'success' | 'failure'; data?: any; error?: string }): Promise<void> {
    const work = await this.store.getWork(workId);
    if (!work) return;
    
    work.lifecycle.completed = new Date().toISOString();
    work.result = {
      status: result.status,
      data: result.data,
      error: result.error,
      retryCount: work.result?.retryCount || 0,
    };
    
    await this.store.saveWork(work);
    
    // 释放资源
    if (work.lifecycle.assigned?.resourceId) {
      const resource = await this.store.getResource(work.lifecycle.assigned.resourceId);
      if (resource) {
        resource.state.status = 'idle';
        resource.state.data = { ...resource.state.data, currentWork: undefined };
        resource.load = Math.max(0, (resource.load || 0) - 1);
        await this.store.saveResource(resource);
      }
    }
  }

  /**
   * 启动调度
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[Engine] Started');
  }

  /**
   * 停止调度
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    console.log('[Engine] Stopped');
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<EngineStats> {
    const resources = await this.store.listResources();
    const works = await this.store.listWorks();

    return {
      resources: {
        total: resources.length,
        idle: resources.filter(r => r.state.status === 'idle').length,
        busy: resources.filter(r => r.state.status === 'busy').length,
        paused: resources.filter(r => r.state.status === 'paused').length,
        offline: resources.filter(r => r.state.status === 'offline').length,
      },
      works: {
        total: works.length,
        pending: works.filter(w => !w.lifecycle.assigned).length,
        running: works.filter(w => w.lifecycle.started && !w.lifecycle.completed).length,
        completed: works.filter(w => w.lifecycle.completed).length,
      },
    };
  }

  // ==================== 树状功能（新增）====================

  /**
   * 按路径查找资源
   * 支持通配符: "/asia/japan/*" 匹配所有日本 Worker
   */
  async findByPath(pattern: string): Promise<Resource[]> {
    const all = await this.store.listResources();
    
    if (pattern === '/*' || pattern === '/') {
      return all;
    }
    
    // 简单通配符匹配
    const regex = pattern
      .replace(/\*\*/g, '___DOUBLE_WILDCARD___')
      .replace(/\*/g, '[^/]+')
      .replace(/___DOUBLE_WILDCARD___/g, '.*');
    
    const pathRegex = new RegExp(`^${regex}$`);
    
    return all.filter(r => {
      const path = r.path || `/${r.id}`;
      return pathRegex.test(path);
    });
  }

  /**
   * 打印树状结构
   */
  async printTree(): Promise<string> {
    const resources = await this.store.listResources();
    
    if (resources.length === 0) {
      return 'No resources';
    }

    // 按路径分组
    const byPath = new Map<string, Resource[]>();
    for (const r of resources) {
      const path = r.path || '/';
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path)!.push(r);
    }

    // 构建树
    const lines: string[] = ['root'];
    
    for (const [path, list] of byPath) {
      if (path === '/') continue;
      
      const segments = path.split('/').filter(Boolean);
      const indent = '  '.repeat(segments.length);
      const name = segments[segments.length - 1];
      
      for (const r of list) {
        const status = r.state.status;
        lines.push(`${indent}${name} [${status}, load=${r.load}/${r.capacity}]`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * 获取树状统计信息
   */
  async getTreeStats(path: string = '/'): Promise<{ totalLeaves: number; availableLeaves: number }> {
    const all = await this.store.listResources();
    
    const filtered = path === '/' 
      ? all 
      : all.filter(r => (r.path || `/${r.id}`).startsWith(path));
    
    return {
      totalLeaves: filtered.length,
      availableLeaves: filtered.filter(r => r.state.status === 'idle').length,
    };
  }
}
