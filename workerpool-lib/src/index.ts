// Workpool Lib v2.0 - 简化导出
export * from './core/types';
export { Engine } from './engine/Engine';
export type { EngineConfig, EngineStats } from './engine/Engine';
export { FileLock } from './lock/FileLock';
export { FileStore } from './store/FileStore';
export { MemoryStore } from './store/MemoryStore';

// TreeEngine 别名（向后兼容）
export { Engine as TreeEngine } from './engine/Engine';
