/**
 * 任务定义 - Workpool Lib
 * 
 * 通用任务模型，支持任意 payload 类型
 */

export type TaskStatus = 
  | 'pending'      // 待分配
  | 'assigned'     // 已分配
  | 'running'      // 执行中
  | 'paused'       // 暂停
  | 'review'       // 待审核
  | 'done'         // 完成
  | 'failed'       // 失败
  | 'timeout';     // 超时

export interface TaskRequirements {
  skills?: string[];        // 所需技能
  minCapacity?: number;     // 最小容量
  maxCapacity?: number;     // 最大容量
}

export interface TaskMeta {
  creator: string;          // 创建者
  assignee?: string;        // 分配给谁
  reviewer?: string;        // 审核者
  tags?: string[];
  githubIssue?: number;     // 可选关联 GitHub Issue
}

export interface Task<T = any> {
  id: string;
  type: string;             // 'deploy' | 'code' | 'trade' | 任意自定义
  status: TaskStatus;
  priority: number;         // 1-100，越高越优先
  payload: T;               // 任务数据（任意类型）
  
  requirements: TaskRequirements;
  meta: TaskMeta;
  
  // 生命周期时间戳
  createdAt: string;        // ISO 8601
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  timeoutAt?: string;       // 超时时间
  
  // 执行结果
  result?: any;
  error?: string;
  retryCount: number;
}

export function createTask<T>(
  id: string,
  type: string,
  payload: T,
  creator: string,
  options?: Partial<Omit<Task<T>, 'id' | 'type' | 'payload' | 'createdAt' | 'retryCount'>> & { meta?: Partial<Task<T>['meta']> }
): Task<T> {
  return {
    id,
    type,
    status: options?.status || 'pending',
    priority: options?.priority || 50,
    payload,
    requirements: options?.requirements || {},
    meta: {
      creator,
      ...(options?.meta || {})
    },
    createdAt: new Date().toISOString(),
    retryCount: 0,
    ...options
  };
}
