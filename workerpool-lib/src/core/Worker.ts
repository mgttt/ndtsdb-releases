/**
 * 工作节点定义 - Workpool Lib
 */

export type WorkerType = 'agent' | 'strategy' | 'generic';

export type WorkerStatus = 
  | 'idle'         // 空闲
  | 'busy'         // 忙碌
  | 'paused'       // 暂停（等待恢复）
  | 'stopping'     // 正在停止（graceful shutdown）
  | 'offline';     // 离线

export type ControlSignal = 
  | 'START'
  | 'PAUSE'        // 暂停（完成当前任务后）
  | 'RESUME'       // 恢复
  | 'STOP'         // 停止（立即）
  | 'KILL';        // 强制终止

export interface ControlState {
  signal: ControlSignal;
  signalTime: string;       // ISO 8601
  ackTime?: string;         // 确认时间
  canStopAt?: string;       // 预计可停时间
  reason?: string;
}

export interface Worker {
  id: string;
  type: WorkerType;
  status: WorkerStatus;
  
  // 当前任务
  currentTask?: string;     // 任务 ID
  taskStartedAt?: string;
  
  // 能力
  capacity: number;         // 最大并发任务数
  load: number;             // 当前负载
  skills: string[];
  
  // 健康
  lastHeartbeat: string;    // ISO 8601
  uptimeSeconds: number;
  
  // 控制
  control: ControlState;
  
  // 元数据
  meta?: Record<string, any>;
}

export function createWorker(
  id: string,
  type: WorkerType,
  options?: Partial<Omit<Worker, 'id' | 'type' | 'lastHeartbeat' | 'uptimeSeconds' | 'control'>>
): Worker {
  const now = new Date().toISOString();
  return {
    id,
    type,
    status: options?.status || 'idle',
    currentTask: options?.currentTask,
    capacity: options?.capacity || 1,
    load: options?.load || 0,
    skills: options?.skills || [],
    lastHeartbeat: now,
    uptimeSeconds: 0,
    control: {
      signal: 'START',
      signalTime: now
    },
    meta: options?.meta,
    ...options
  };
}

export interface WorkerFilter {
  status?: WorkerStatus | WorkerStatus[];
  type?: WorkerType;
  skills?: string[];        // 包含任意一个技能
  minCapacity?: number;
  available?: boolean;      // status === 'idle' && load < capacity
}
