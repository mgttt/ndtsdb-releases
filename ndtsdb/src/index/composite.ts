// ============================================================
// 复合索引（多列组合）
// 例如：(symbol, timestamp) → 先按 symbol 分组，再按 timestamp 建 BTree
// ============================================================

import { BTreeIndex } from './btree.js';

type IndexKey = number | bigint | string;

/**
 * 复合索引：支持多列组合查询
 * 
 * 例子：
 * - (symbol, timestamp) → Map<symbol, BTreeIndex<timestamp>>
 * - 查询 symbol='BTC' AND timestamp>=1000 → 先定位 symbol，再用 BTree 范围查询
 */
export class CompositeIndex {
  private columns: string[];
  private index: Map<string, any>; // 递归嵌套结构

  constructor(columns: string[]) {
    if (columns.length < 2) {
      throw new Error('Composite index requires at least 2 columns');
    }
    this.columns = columns;
    this.index = new Map();
  }

  /**
   * 插入一条记录到复合索引
   */
  insert(values: IndexKey[], rowIndex: number): void {
    if (values.length !== this.columns.length) {
      throw new Error(`Expected ${this.columns.length} values, got ${values.length}`);
    }

    this.insertRecursive(this.index, values, 0, rowIndex);
  }

  private insertRecursive(
    level: Map<string, any>,
    values: IndexKey[],
    depth: number,
    rowIndex: number,
  ): void {
    const key = String(values[depth]); // 统一转字符串作为 Map key

    if (depth === values.length - 1) {
      // 最后一层：使用 BTree 存储行号
      if (!level.has(key)) {
        level.set(key, new BTreeIndex<IndexKey>(32));
      }
      const btree = level.get(key) as BTreeIndex<IndexKey>;
      btree.insert(values[depth], rowIndex);
    } else {
      // 中间层：继续嵌套 Map
      if (!level.has(key)) {
        level.set(key, new Map());
      }
      this.insertRecursive(level.get(key) as Map<string, any>, values, depth + 1, rowIndex);
    }
  }

  /**
   * 查询复合索引
   * @param filters 条件对象，例如：{ symbol: 'BTC', timestamp: { gte: 1000 } }
   * @returns 匹配的行号数组
   */
  query(filters: Record<string, IndexKey | { gte?: IndexKey; lte?: IndexKey; gt?: IndexKey; lt?: IndexKey }>): number[] {
    // 从第一列开始递归查询
    return this.queryRecursive(this.index, filters, 0);
  }

  private queryRecursive(
    level: Map<string, any>,
    filters: Record<string, any>,
    depth: number,
  ): number[] {
    const colName = this.columns[depth];
    const filter = filters[colName];

    if (filter === undefined) {
      // 没有该列的过滤条件 → 扫描所有子树
      const results: number[] = [];
      for (const child of level.values()) {
        if (depth === this.columns.length - 1) {
          // 最后一层：BTree
          const btree = child as BTreeIndex<IndexKey>;
          results.push(...btree.getAllRows());
        } else {
          // 中间层：递归
          results.push(...this.queryRecursive(child as Map<string, any>, filters, depth + 1));
        }
      }
      return results;
    }

    // 范围查询（只在最后一层 BTree 有效）
    if (typeof filter === 'object' && ('gte' in filter || 'lte' in filter || 'gt' in filter || 'lt' in filter)) {
      if (depth !== this.columns.length - 1) {
        throw new Error('Range query only supported on the last column');
      }

      // 此时 level 应该只有一个 entry（前面的列已经精确匹配）
      // 但为了安全，遍历所有 BTree（如果前面有列没有过滤条件）
      const results: number[] = [];
      for (const btree of level.values()) {
        const tree = btree as BTreeIndex<IndexKey>;
        const { gte, lte, gt, lt } = filter;

        if (gte !== undefined && lte !== undefined) {
          results.push(...tree.rangeQuery(gte as any, lte as any));
        } else if (gt !== undefined && lt !== undefined) {
          // gt 和 lt 之间的范围（不包含边界）
          const allGt = tree.greaterThan(gt as any);
          const allLt = tree.lessThan(lt as any);
          const gtSet = new Set(allGt);
          results.push(...allLt.filter(r => gtSet.has(r)));
        } else if (gte !== undefined) {
          results.push(...tree.greaterThanOrEqual(gte as any));
        } else if (gt !== undefined) {
          results.push(...tree.greaterThan(gt as any));
        } else if (lte !== undefined) {
          // lte 需要包含等于的值
          const ltRows = tree.lessThan(lte as any);
          const eqRows = tree.query(lte as any);
          results.push(...ltRows, ...eqRows);
        } else if (lt !== undefined) {
          results.push(...tree.lessThan(lt as any));
        }
      }
      return results;
    }

    // 精确匹配
    const key = String(filter);
    if (!level.has(key)) {
      return []; // 没有匹配
    }

    const child = level.get(key);

    if (depth === this.columns.length - 1) {
      // 最后一层：BTree
      const btree = child as BTreeIndex<IndexKey>;
      return btree.query(filter as any);
    } else {
      // 中间层：递归
      return this.queryRecursive(child as Map<string, any>, filters, depth + 1);
    }
  }

  /**
   * 获取索引列
   */
  getColumns(): string[] {
    return [...this.columns];
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.index.clear();
  }
}
