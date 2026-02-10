// Workpool Lib v2.0 - 简化导出
export * from './core/types';
export { Pool, LeastLoadedStrategy, SkillMatchStrategy } from './core/Pool';
export type { PoolStats, AllocationStrategy } from './core/Pool';
export { createWorker } from './core/Worker';
export type { Worker, WorkerType, WorkerStatus, ControlSignal, ControlState, WorkerFilter } from './core/Worker';
export { createTask } from './core/Task';
export type { Task, TaskStatus, TaskRequirements, TaskMeta } from './core/Task';
export { Engine } from './engine/Engine';
export type { EngineConfig, EngineStats } from './engine/Engine';
export { FileLock } from './lock/FileLock';
export { FileStore } from './store/FileStore';
export { MemoryStore } from './store/MemoryStore';

// TreeEngine 别名（向后兼容）
export { Engine as TreeEngine } from './engine/Engine';
