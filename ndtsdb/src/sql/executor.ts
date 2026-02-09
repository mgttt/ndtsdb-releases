// ============================================================
// SQL 执行器 - 将 SQL 解析结果转换为 ColumnarTable 操作
// ============================================================

import { ColumnarTable } from '../columnar.js';
import type { SQLStatement, SQLSelect, SQLCondition, SQLOperator, SQLUpsert } from './parser.js';

export interface SQLQueryResult {
  columns: string[];
  rows: Array<Record<string, number | bigint | string>>;
  rowCount: number;
}

export class SQLExecutor {
  private tables: Map<string, ColumnarTable> = new Map();

  // 注册表
  registerTable(name: string, table: ColumnarTable): void {
    this.tables.set(name.toLowerCase(), table);
  }

  // 获取表
  getTable(name: string): ColumnarTable | undefined {
    return this.tables.get(name.toLowerCase());
  }

  // 执行 SQL
  execute(statement: SQLStatement): SQLQueryResult | number {
    switch (statement.type) {
      case 'SELECT':
        return this.executeSelect(statement.data);
      case 'INSERT':
        return this.executeInsert(statement.data);
      case 'UPSERT':
        return this.executeUpsert(statement.data);
      default:
        throw new Error(`Unsupported statement type: ${statement.type}`);
    }
  }

  // 执行 SELECT
  private executeSelect(select: SQLSelect): SQLQueryResult {
    const table = this.getTable(select.from);
    if (!table) {
      throw new Error(`Table not found: ${select.from}`);
    }

    // 获取所有列
    const allColumns = table.getColumnNames ? table.getColumnNames() : this.inferColumnNames(table);
    
    // 确定要查询的列
    const selectedColumns = select.columns[0] === '*' 
      ? allColumns 
      : select.columns.map(c => typeof c === 'string' ? c : c.expr);

    // 执行 WHERE 过滤
    let rowIndices: number[] | undefined;
    if (select.where && select.where.length > 0) {
      rowIndices = this.evaluateWhere(table, select.where);
    }

    // 获取过滤后的数据
    let rows = this.extractRows(table, selectedColumns, rowIndices);

    // 执行 GROUP BY
    if (select.groupBy && select.groupBy.length > 0) {
      rows = this.executeGroupBy(rows, selectedColumns, select.groupBy);
    }

    // 执行 ORDER BY
    if (select.orderBy && select.orderBy.length > 0) {
      rows = this.executeOrderBy(rows, select.orderBy);
    }

    // 执行 LIMIT/OFFSET
    if (select.offset !== undefined) {
      rows = rows.slice(select.offset);
    }
    if (select.limit !== undefined) {
      rows = rows.slice(0, select.limit);
    }

    return {
      columns: selectedColumns,
      rows,
      rowCount: rows.length
    };
  }

  // 评估 WHERE 条件
  private evaluateWhere(table: ColumnarTable, conditions: SQLCondition[]): number[] {
    const matchingIndices: number[] = [];
    const rowCount = table.getRowCount();

    for (let i = 0; i < rowCount; i++) {
      let match = true;
      
      for (let j = 0; j < conditions.length; j++) {
        const cond = conditions[j];
        const value = this.getColumnValue(table, cond.column, i);
        const condMatch = this.evaluateCondition(value, cond.operator, cond.value);
        
        if (j === 0) {
          match = condMatch;
        } else {
          const prevLogic = conditions[j - 1].logic || 'AND';
          if (prevLogic === 'AND') {
            match = match && condMatch;
          } else {
            match = match || condMatch;
          }
        }
      }

      if (match) {
        matchingIndices.push(i);
      }
    }

    return matchingIndices;
  }

  // 评估单个条件
  private evaluateCondition(value: any, operator: SQLOperator, compareValue: any): boolean {
    switch (operator) {
      case '=':
        return value === compareValue;
      case '!=':
      case '<>':
        return value !== compareValue;
      case '<':
        return value < compareValue;
      case '>':
        return value > compareValue;
      case '<=':
        return value <= compareValue;
      case '>=':
        return value >= compareValue;
      case 'IN':
        return Array.isArray(compareValue) && compareValue.includes(value);
      case 'LIKE':
        return this.likeMatch(String(value), String(compareValue));
      default:
        return false;
    }
  }

  // LIKE 匹配 (简化版)
  private likeMatch(value: string, pattern: string): boolean {
    // 支持 % 通配符
    const regex = pattern
      .replace(/%/g, '.*')
      .replace(/_/g, '.');
    return new RegExp(`^${regex}$`, 'i').test(value);
  }

  // 获取列值
  private getColumnValue(table: ColumnarTable, column: string, rowIndex: number): any {
    const col = table.getColumn(column);
    if (!col) return undefined;
    return col[rowIndex];
  }

  // 提取行数据
  private extractRows(
    table: ColumnarTable, 
    columns: string[], 
    indices?: number[]
  ): Array<Record<string, any>> {
    const rows: Array<Record<string, any>> = [];
    const rowCount = indices?.length ?? table.getRowCount();
    const actualIndices = indices ?? Array.from({ length: rowCount }, (_, i) => i);

    for (const idx of actualIndices) {
      const row: Record<string, any> = {};
      for (const col of columns) {
        row[col] = this.getColumnValue(table, col, idx);
      }
      rows.push(row);
    }

    return rows;
  }

  // 执行 GROUP BY
  private executeGroupBy(
    rows: Array<Record<string, any>>,
    columns: string[],
    groupByCols: string[]
  ): Array<Record<string, any>> {
    // 按 groupBy 列分组
    const groups = new Map<string, Array<Record<string, any>>>();
    
    for (const row of rows) {
      const key = groupByCols.map(col => row[col]).join('|');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }

    // 聚合每组
    const result: Array<Record<string, any>> = [];
    
    for (const [key, groupRows] of groups) {
      const aggregated: Record<string, any> = {};
      
      for (const col of columns) {
        if (groupByCols.includes(col)) {
          // GROUP BY 列取第一个值
          aggregated[col] = groupRows[0][col];
        } else {
          // 聚合列
          aggregated[col] = this.aggregateColumn(groupRows, col);
        }
      }
      
      result.push(aggregated);
    }

    return result;
  }

  // 聚合列
  private aggregateColumn(rows: Array<Record<string, any>>, column: string): any {
    // 简化：如果是聚合函数表达式，解析并计算
    const colLower = column.toLowerCase();
    
    if (colLower.startsWith('count(')) {
      return rows.length;
    }
    
    if (colLower.startsWith('sum(')) {
      const colName = this.extractColumnFromExpr(column);
      return rows.reduce((sum, row) => sum + (Number(row[colName]) || 0), 0);
    }
    
    if (colLower.startsWith('avg(')) {
      const colName = this.extractColumnFromExpr(column);
      const sum = rows.reduce((s, row) => s + (Number(row[colName]) || 0), 0);
      return sum / rows.length;
    }
    
    if (colLower.startsWith('min(')) {
      const colName = this.extractColumnFromExpr(column);
      return Math.min(...rows.map(r => Number(r[colName]) || Infinity));
    }
    
    if (colLower.startsWith('max(')) {
      const colName = this.extractColumnFromExpr(column);
      return Math.max(...rows.map(r => Number(r[colName]) || -Infinity));
    }
    
    if (colLower.startsWith('first(')) {
      const colName = this.extractColumnFromExpr(column);
      return rows[0]?.[colName];
    }
    
    if (colLower.startsWith('last(')) {
      const colName = this.extractColumnFromExpr(column);
      return rows[rows.length - 1]?.[colName];
    }
    
    // 非聚合列，取第一个值
    return rows[0]?.[column];
  }

  // 从表达式提取列名
  private extractColumnFromExpr(expr: string): string {
    const match = expr.match(/\(([^)]+)\)/);
    return match ? match[1].trim() : expr;
  }

  // 执行 ORDER BY
  private executeOrderBy(
    rows: Array<Record<string, any>>,
    orderBy: { column: string; direction: 'ASC' | 'DESC' }[]
  ): Array<Record<string, any>> {
    return rows.sort((a, b) => {
      for (const { column, direction } of orderBy) {
        const valA = a[column];
        const valB = b[column];
        
        if (valA < valB) return direction === 'ASC' ? -1 : 1;
        if (valA > valB) return direction === 'ASC' ? 1 : -1;
      }
      return 0;
    });
  }

  // 执行 INSERT
  private executeInsert(insert: any): number {
    const table = this.getTable(insert.into);
    if (!table) {
      throw new Error(`Table not found: ${insert.into}`);
    }

    // 转换为 ColumnarTable 格式
    const rows = insert.values.map((row: any[]) => {
      const obj: Record<string, any> = {};
      insert.columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj;
    });

    table.appendBatch(rows);
    return rows.length;
  }

  // 执行 UPSERT
  private executeUpsert(upsert: SQLUpsert): number {
    const table = this.getTable(upsert.into);
    if (!table) {
      throw new Error(`Table not found: ${upsert.into}`);
    }

    // 构建主键索引 (首次 upsert 时扫描全表)
    const keyIndex = this.buildKeyIndex(table, upsert.conflictColumns);
    
    let inserted = 0;
    let updated = 0;

    for (const values of upsert.values) {
      // 构建行对象
      const row: Record<string, any> = {};
      upsert.columns.forEach((col, i) => {
        row[col] = values[i];
      });

      // 生成主键
      const key = this.makeKey(row, upsert.conflictColumns);
      const existingIndex = keyIndex.get(key);

      if (existingIndex !== undefined) {
        // UPDATE: 更新指定列
        const updateData: Record<string, any> = {};
        for (const col of upsert.updateColumns) {
          updateData[col] = row[col];
        }
        table.updateRow(existingIndex, updateData);
        updated++;
      } else {
        // INSERT: 新增行
        table.append(row);
        keyIndex.set(key, table.getRowCount() - 1);
        inserted++;
      }
    }

    return inserted + updated;
  }

  // 构建主键索引
  private buildKeyIndex(
    table: ColumnarTable, 
    keyColumns: string[]
  ): Map<string, number> {
    const index = new Map<string, number>();
    const rowCount = table.getRowCount();

    // 获取主键列的 TypedArray
    const keyArrays = keyColumns.map(col => table.getColumn(col));
    
    for (let i = 0; i < rowCount; i++) {
      const keyParts: string[] = [];
      for (let j = 0; j < keyColumns.length; j++) {
        const arr = keyArrays[j];
        if (arr) {
          keyParts.push(String(arr[i]));
        }
      }
      const key = keyParts.join('|');
      index.set(key, i);
    }

    return index;
  }

  // 生成主键字符串
  private makeKey(row: Record<string, any>, keyColumns: string[]): string {
    return keyColumns.map(col => String(row[col])).join('|');
  }

  // 推断列名 (简化)
  private inferColumnNames(table: ColumnarTable): string[] {
    // 应该从表的 schema 获取
    return ['timestamp', 'symbol', 'price', 'volume']; // 默认值
  }
}
