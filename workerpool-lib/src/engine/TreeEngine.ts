/**
 * TreeEngine - 树状资源管理
 * 
 * 现在是 Engine 的别名，Engine 已内置树状功能
 * 保留此文件以兼容现有代码
 */

export { Engine as TreeEngine } from './Engine';
export type { 
  TreeNode, 
  PathResource, 
  TreeWorkRequirements,
  TreeEngineConfig 
} from './Engine';

// 这些类型现在从 Engine 重新导出
type TreeNode<T = any> = {
  id: string;
  path: string;
  type: 'root' | 'branch' | 'leaf';
  parent?: TreeNode<T>;
  children: Map<string, TreeNode<T>>;
  data?: T;
  stats: {
    totalLeaves: number;
    availableLeaves: number;
  };
};

type PathResource<Spec = any, State = any> = import('../core/types').Resource<Spec, State> & {
  path: string;
};

type TreeWorkRequirements = {
  capabilities: string[];
  path?: string;
  minCapacity?: number;
};

type TreeEngineConfig = import('./Engine').EngineConfig;
