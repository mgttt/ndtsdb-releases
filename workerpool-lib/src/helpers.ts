/**
 * 辅助函数 - 简化创建 Resource 和 Work
 */

import type { Resource, Work } from './core/types';

/**
 * 创建 Resource（极简）
 */
export function createResource(
  id: string,
  capabilities: string[],
  capacity: number,
  spec?: any
): Resource {
  const now = new Date().toISOString();
  return {
    id,
    spec: spec || {},
    state: {
      status: 'idle',
      data: {},
      since: now
    },
    capabilities,
    capacity,
    load: 0,
    meta: {
      type: spec?.type,
      adapter: spec?.adapter,
      createdAt: now,
      lastHeartbeat: now
    }
  };
}

/**
 * 创建 Work（极简）
 */
export function createWork(
  id: string,
  payload: any,
  requirements: string[],
  options?: {
    priority?: number;
    timeoutMinutes?: number;
    meta?: Record<string, any>;
  }
): Work {
  const now = new Date().toISOString();
  return {
    id,
    payload,
    requirements: {
      capabilities: requirements
    },
    priority: options?.priority ?? 50,
    timeoutMinutes: options?.timeoutMinutes ?? 30,
    lifecycle: {
      created: now
    },
    result: {
      status: 'success',
      retryCount: 0
    },
    meta: options?.meta
  };
}

/**
 * 创建 Resource（完整类型安全）
 */
export function createResourceTyped<Spec, State>(
  id: string,
  spec: Spec,
  capabilities: string[],
  capacity: number,
  initialState: State,
  options?: {
    type?: string;
    adapter?: string;
    meta?: Record<string, any>;
  }
): Resource<Spec, State> {
  const now = new Date().toISOString();
  return {
    id,
    spec,
    state: {
      status: 'idle',
      data: initialState,
      since: now
    },
    capabilities,
    capacity,
    load: 0,
    meta: {
      type: options?.type,
      adapter: options?.adapter,
      createdAt: now,
      lastHeartbeat: now,
      ...options?.meta
    }
  };
}

/**
 * 创建 Work（完整类型安全）
 */
export function createWorkTyped<Payload, Result>(
  id: string,
  payload: Payload,
  requirements: string[],
  options?: {
    priority?: number;
    timeoutMinutes?: number;
    meta?: Record<string, any>;
  }
): Work<Payload, Result> {
  const now = new Date().toISOString();
  return {
    id,
    payload,
    requirements: {
      capabilities: requirements
    },
    priority: options?.priority ?? 50,
    timeoutMinutes: options?.timeoutMinutes ?? 30,
    lifecycle: {
      created: now
    },
    result: {
      status: 'success',
      retryCount: 0
    },
    meta: options?.meta
  };
}
