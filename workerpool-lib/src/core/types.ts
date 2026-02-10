/**
 * Core Types - Workpool Lib
 * 
 * Shared types to avoid circular dependencies
 */

// ==================== Resource Types ====================

export type ResourceStatus = 
  | 'idle'
  | 'busy'
  | 'paused'
  | 'stopped'
  | 'offline';

export interface Resource<Spec = any, State = any> {
  id: string;
  path?: string;  // 树路径: "/asia/japan/worker-001"
  spec: Spec;
  state: {
    status: ResourceStatus;
    data: State;
    since: string;
    currentWork?: string;
  };
  capabilities: string[];
  capacity: number;
  load: number;
  meta?: {
    type?: string;
    adapter?: string;
    createdAt: string;
    lastHeartbeat: string;
  };
}

// ==================== Work Types ====================

export interface Work<Payload = any, Result = any> {
  id: string;
  payload: Payload;
  requirements: {
    capabilities: string[];
    minCapacity?: number;
  };
  priority: number;
  timeoutMinutes: number;
  lifecycle: {
    created: string;
    assigned?: { resourceId: string; at: string };
    started?: string;
    completed?: string;
  };
  result?: {
    status: 'success' | 'failure' | 'timeout' | 'cancelled';
    data?: Result;
    error?: string;
    retryCount: number;
  };
  meta?: Record<string, any>;
}

// ==================== Other Core Types ====================

export type ControlSignal = 'PAUSE' | 'RESUME' | 'STOP' | 'KILL';

export interface ResourceFilter {
  status?: ResourceStatus | ResourceStatus[];
  capabilities?: string[];
  available?: boolean;
  type?: string;
}

export interface WorkFilter {
  status?: 'pending' | 'assigned' | 'running' | 'completed';
  assignedTo?: string;
  priorityMin?: number;
}

export interface AckInfo {
  status: 'ACKED' | 'REJECTED' | 'TIMEOUT';
  timestamp: string;
  canStopAt?: string;
}

// ==================== Adapter Interface ====================

export interface Adapter<Spec = any, State = any> {
  readonly name: string;
  init(resource: Resource<Spec, State>): Promise<void>;
  getState(resourceId: string, spec: Spec): Promise<State>;
  healthCheck(resourceId: string, spec: Spec): Promise<boolean>;
  control(resourceId: string, spec: Spec, signal: ControlSignal): Promise<void>;
  execute?<Payload, Result>(
    resourceId: string, 
    spec: Spec, 
    work: Work<Payload, Result>
  ): Promise<Result>;
  destroy(resourceId: string, spec: Spec): Promise<void>;
}

export class NoOpAdapter implements Adapter {
  readonly name = 'noop';
  async init() {}
  async getState() { return {}; }
  async healthCheck() { return true; }
  async control() {}
  async destroy() {}
}

// ==================== Store Interface ====================

export interface Store {
  saveResource<R extends Resource>(resource: R): Promise<void>;
  getResource<R extends Resource>(id: string): Promise<R | null>;
  listResources<R extends Resource>(filter?: ResourceFilter): Promise<R[]>;
  deleteResource(id: string): Promise<void>;
  
  saveWork<W extends Work>(work: W): Promise<void>;
  getWork<W extends Work>(id: string): Promise<W | null>;
  listWorks<W extends Work>(filter?: WorkFilter): Promise<W[]>;
  deleteWork(id: string): Promise<void>;
  
  saveControlSignal(resourceId: string, signal: ControlSignal): Promise<void>;
  getControlSignal(resourceId: string): Promise<ControlSignal | null>;
  saveAck(resourceId: string, ack: AckInfo): Promise<void>;
  getAck(resourceId: string): Promise<AckInfo | null>;
  
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

// ==================== Allocation Strategy ====================

export interface AllocationStrategy {
  readonly name: string;
  select<R extends Resource, W extends Work>(
    work: W, 
    candidates: R[]
  ): R | null;
}
