// ============================================================
// SQL 执行器 - 将 SQL 解析结果转换为 ColumnarTable 操作
//
// 目标：支持时序场景常用的 SQL 子集，并逐步扩展到窗口聚合能力。
// ============================================================

import { ColumnarTable } from '../columnar.js';
import type { SQLStatement, SQLSelect, SQLCondition, SQLOperator, SQLUpsert } from './parser.js';

export interface SQLQueryResult {
  columns: string[];
  rows: Array<Record<string, number | bigint | string>>;
  rowCount: number;
}

type SelectItem = { expr: string; name: string };

type WindowSpec = {
  func: 'row_number' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'variance' | 'stddev';
  arg?: string; // column name or '*'
  partitionBy: string[];
  orderBy?: { column: string; direction: 'ASC' | 'DESC' };
  frame?: { kind: 'rows'; preceding: number | 'unbounded'; following: 0 };
};

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
    if (!table) throw new Error(`Table not found: ${select.from}`);

    const allColumns = table.getColumnNames ? table.getColumnNames() : this.inferColumnNames(table);

    // WHERE 过滤
    let rowIndices: number[] | undefined;
    if (select.where && select.where.length > 0) {
      rowIndices = this.evaluateWhere(table, select.where);
    }

    // SELECT * 快速路径
    if (select.columns[0] === '*') {
      let rows = this.extractRows(table, allColumns, rowIndices);

      if (select.orderBy && select.orderBy.length > 0) {
        rows = this.executeOrderBy(rows, select.orderBy);
      }
      if (select.offset !== undefined) rows = rows.slice(select.offset);
      if (select.limit !== undefined) rows = rows.slice(0, select.limit);

      return { columns: allColumns, rows, rowCount: rows.length };
    }

    // 规范化选择项（保留 alias）
    const selections: SelectItem[] = select.columns.map((c) => {
      if (typeof c === 'string') return { expr: c, name: c };
      return { expr: c.expr, name: c.alias || c.expr };
    });

    // 简化实现：直接抽全列，后续再按需裁剪（在大表上可优化）
    let baseRows = this.extractRows(table, allColumns, rowIndices);

    // 计算窗口函数 + 别名映射（在 baseRows 上追加派生列）
    this.applyWindowAndAliases(baseRows, selections);

    // 投影 / GROUP BY
    let rows: Array<Record<string, any>>;
    if (select.groupBy && select.groupBy.length > 0) {
      // 当前实现不支持「GROUP BY + 窗口函数」混用（后续可扩展）
      rows = this.executeGroupBy(baseRows, selections, select.groupBy);
    } else {
      rows = baseRows.map((r) => this.projectRow(r, selections));
    }

    // ORDER BY
    if (select.orderBy && select.orderBy.length > 0) {
      rows = this.executeOrderBy(rows, select.orderBy);
    }

    // LIMIT/OFFSET
    if (select.offset !== undefined) rows = rows.slice(select.offset);
    if (select.limit !== undefined) rows = rows.slice(0, select.limit);

    return {
      columns: selections.map((s) => s.name),
      rows,
      rowCount: rows.length,
    };
  }

  private projectRow(row: Record<string, any>, selections: SelectItem[]): Record<string, any> {
    const out: Record<string, any> = {};
    for (const s of selections) {
      // 优先取派生列（alias / window result）
      if (Object.prototype.hasOwnProperty.call(row, s.name)) {
        out[s.name] = row[s.name];
        continue;
      }

      // fallback：直接取原列名
      out[s.name] = row[s.expr];
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // WHERE
  // ---------------------------------------------------------------------------

  private evaluateWhere(table: ColumnarTable, conditions: SQLCondition[]): number[] {
    const matching: number[] = [];
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
          match = prevLogic === 'AND' ? match && condMatch : match || condMatch;
        }
      }

      if (match) matching.push(i);
    }

    return matching;
  }

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

  private likeMatch(value: string, pattern: string): boolean {
    const regex = pattern.replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp(`^${regex}$`, 'i').test(value);
  }

  private getColumnValue(table: ColumnarTable, column: string, rowIndex: number): any {
    const col = table.getColumn(column);
    if (!col) return undefined;
    return col[rowIndex];
  }

  // ---------------------------------------------------------------------------
  // Rows extraction
  // ---------------------------------------------------------------------------

  private extractRows(table: ColumnarTable, columns: string[], indices?: number[]): Array<Record<string, any>> {
    const rows: Array<Record<string, any>> = [];
    const rowCount = indices?.length ?? table.getRowCount();
    const actual = indices ?? Array.from({ length: rowCount }, (_, i) => i);

    for (const idx of actual) {
      const row: Record<string, any> = {};
      for (const col of columns) {
        row[col] = this.getColumnValue(table, col, idx);
      }
      rows.push(row);
    }

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Window functions + aliases
  // ---------------------------------------------------------------------------

  private applyWindowAndAliases(rows: Array<Record<string, any>>, selections: SelectItem[]): void {
    // 1) 先做简单 alias：SELECT close AS price
    for (const s of selections) {
      if (s.name === s.expr) continue;
      const expr = this.normalizeExpr(s.expr);

      // 仅处理“纯列名别名”（不处理复杂表达式别名）
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expr)) {
        for (const r of rows) {
          if (!Object.prototype.hasOwnProperty.call(r, s.name)) {
            r[s.name] = r[expr];
          }
        }
      }
    }

    // 2) 计算窗口函数
    const windowItems: Array<{ spec: WindowSpec; name: string; rawExpr: string }> = [];
    for (const s of selections) {
      const spec = this.parseWindowExpr(s.expr);
      if (spec) windowItems.push({ spec, name: s.name, rawExpr: s.expr });
    }

    for (const item of windowItems) {
      const values = this.computeWindowColumn(rows, item.spec);
      for (let i = 0; i < rows.length; i++) {
        rows[i][item.name] = values[i];
      }
    }
  }

  private parseWindowExpr(expr: string): WindowSpec | null {
    const s = this.normalizeExpr(expr);
    if (!/\bOVER\b/i.test(s)) return null;

    // ROW_NUMBER() OVER (...)
    {
      const m = s.match(/^ROW_NUMBER\s*\(\s*\)\s*OVER\s*\(\s*(.+)\s*\)$/i);
      if (m) {
        const over = m[1];
        return {
          func: 'row_number',
          partitionBy: this.parsePartitionBy(over),
          orderBy: this.parseOrderBy(over),
          frame: this.parseRowsFrame(over),
        };
      }
    }

    // FUNC(arg) OVER (...)
    const m = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([^)]*)\s*\)\s*OVER\s*\(\s*(.+)\s*\)$/i);
    if (!m) return null;

    const funcRaw = m[1].toLowerCase();
    const argRaw = m[2].trim();
    const over = m[3];

    const func = this.mapWindowFunc(funcRaw);
    if (!func) return null;

    return {
      func,
      arg: argRaw === '' ? undefined : argRaw,
      partitionBy: this.parsePartitionBy(over),
      orderBy: this.parseOrderBy(over),
      frame: this.parseRowsFrame(over),
    };
  }

  private mapWindowFunc(func: string): WindowSpec['func'] | null {
    switch (func) {
      case 'count':
        return 'count';
      case 'sum':
        return 'sum';
      case 'avg':
        return 'avg';
      case 'min':
        return 'min';
      case 'max':
        return 'max';
      case 'variance':
      case 'var':
        return 'variance';
      case 'stddev':
      case 'std':
        return 'stddev';
      default:
        return null;
    }
  }

  private parsePartitionBy(over: string): string[] {
    const m = over.match(/PARTITION\s+BY\s+(.+?)(?=(ORDER\s+BY|ROWS\s+BETWEEN|$))/i);
    if (!m) return [];
    return m[1].split(',').map((x) => x.trim()).filter(Boolean);
  }

  private parseOrderBy(over: string): { column: string; direction: 'ASC' | 'DESC' } | undefined {
    const m = over.match(/ORDER\s+BY\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(ASC|DESC))?/i);
    if (!m) return undefined;
    return { column: m[1], direction: ((m[2] || 'ASC').toUpperCase() as 'ASC' | 'DESC') };
  }

  private parseRowsFrame(over: string): WindowSpec['frame'] | undefined {
    // ROWS BETWEEN 96 PRECEDING AND CURRENT ROW
    const m = over.match(/ROWS\s+BETWEEN\s+(\d+|UNBOUNDED)\s+PRECEDING\s+AND\s+CURRENT\s+ROW/i);
    if (!m) return undefined;
    const p = m[1].toUpperCase() === 'UNBOUNDED' ? 'unbounded' : Number(m[1]);
    return { kind: 'rows', preceding: p as any, following: 0 };
  }

  private computeWindowColumn(rows: Array<Record<string, any>>, spec: WindowSpec): Array<number> {
    const out = new Array<number>(rows.length).fill(NaN);

    const partCols = spec.partitionBy || [];
    const order = spec.orderBy;
    const dir = order?.direction || 'ASC';

    // 分组
    const groups = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const key = partCols.length === 0 ? '__all__' : partCols.map((c) => String(r[c])).join('|');
      let arr = groups.get(key);
      if (!arr) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push(i);
    }

    for (const indices of groups.values()) {
      // order
      if (order) {
        indices.sort((ia, ib) => {
          const a = rows[ia][order.column];
          const b = rows[ib][order.column];
          const cmp = this.compareValues(a, b);
          return dir === 'ASC' ? cmp : -cmp;
        });
      }

      if (spec.func === 'row_number') {
        for (let p = 0; p < indices.length; p++) {
          out[indices[p]] = p + 1;
        }
        continue;
      }

      const argCol = spec.arg && spec.arg !== '*' ? spec.arg : undefined;
      if (!argCol) {
        // count(*) only
        if (spec.func !== 'count') continue;
      }

      const preceding = spec.frame?.preceding ?? 'unbounded';
      const winLen = preceding === 'unbounded' ? Infinity : (preceding as number) + 1;

      // 目前 window 聚合仅支持数值列（count(*) 例外）
      const buf = winLen !== Infinity ? new Float64Array(winLen) : null;
      let head = 0;
      let size = 0;
      let sum = 0;
      let sumSq = 0;

      // min/max 用 deque
      const dequeIdx: number[] = [];
      const dequeVal: number[] = [];

      const pushVal = (v: number) => {
        if (!buf) return;
        buf[(head + size) % buf.length] = v;
        size++;
      };
      const popVal = (): number => {
        if (!buf || size === 0) return NaN;
        const v = buf[head];
        head = (head + 1) % buf.length;
        size--;
        return v;
      };

      const dequePush = (pos: number, v: number, isMin: boolean) => {
        // maintain monotonic
        while (dequeIdx.length > 0) {
          const last = dequeVal[dequeVal.length - 1];
          if (isMin ? last <= v : last >= v) break;
          dequeIdx.pop();
          dequeVal.pop();
        }
        dequeIdx.push(pos);
        dequeVal.push(v);
      };

      const dequeExpire = (pos: number, window: number) => {
        const minPos = pos - window + 1;
        while (dequeIdx.length > 0 && dequeIdx[0] < minPos) {
          dequeIdx.shift();
          dequeVal.shift();
        }
      };

      for (let p = 0; p < indices.length; p++) {
        const ridx = indices[p];

        if (spec.func === 'count' && spec.arg === '*') {
          if (winLen === Infinity) {
            out[ridx] = p + 1;
          } else {
            out[ridx] = Math.min(p + 1, winLen);
          }
          continue;
        }

        const raw = rows[ridx][argCol!];
        const v = typeof raw === 'bigint' ? Number(raw) : Number(raw);
        if (!Number.isFinite(v)) {
          out[ridx] = NaN;
          continue;
        }

        // add
        if (winLen !== Infinity) {
          pushVal(v);
          if (size > (winLen as number)) {
            const old = popVal();
            sum -= old;
            sumSq -= old * old;
            if (spec.func === 'min' || spec.func === 'max') {
              dequeExpire(p, winLen as number);
            }
          }
        }

        sum += v;
        sumSq += v * v;

        // update deque after expire handled
        if (spec.func === 'min' || spec.func === 'max') {
          dequePush(p, v, spec.func === 'min');
          if (winLen !== Infinity) {
            dequeExpire(p, winLen as number);
          }
        }

        const n = winLen === Infinity ? (p + 1) : size;
        out[ridx] = this.windowAggValue(spec.func, n, sum, sumSq, dequeVal[0]);
      }
    }

    return out;
  }

  private windowAggValue(func: WindowSpec['func'], n: number, sum: number, sumSq: number, dequeFront: number | undefined): number {
    if (n <= 0) return NaN;

    switch (func) {
      case 'count':
        return n;
      case 'sum':
        return sum;
      case 'avg':
        return sum / n;
      case 'min':
      case 'max':
        return dequeFront ?? NaN;
      case 'variance': {
        if (n <= 1) return 0;
        const mean = sum / n;
        const varSamp = (sumSq - n * mean * mean) / (n - 1);
        return Math.max(0, varSamp);
      }
      case 'stddev': {
        if (n <= 1) return 0;
        const mean = sum / n;
        const varSamp = (sumSq - n * mean * mean) / (n - 1);
        return Math.sqrt(Math.max(0, varSamp));
      }
      default:
        return NaN;
    }
  }

  private compareValues(a: any, b: any): number {
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
    // fallback
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  private normalizeExpr(expr: string): string {
    return String(expr).replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------------------
  // GROUP BY
  // ---------------------------------------------------------------------------

  private executeGroupBy(rows: Array<Record<string, any>>, selections: SelectItem[], groupByCols: string[]): Array<Record<string, any>> {
    const groups = new Map<string, Array<Record<string, any>>>();

    for (const row of rows) {
      const key = groupByCols.map((c) => String(row[c])).join('|');
      let arr = groups.get(key);
      if (!arr) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push(row);
    }

    const result: Array<Record<string, any>> = [];

    for (const groupRows of groups.values()) {
      const aggregated: Record<string, any> = {};

      for (const sel of selections) {
        if (groupByCols.includes(sel.expr) || groupByCols.includes(sel.name)) {
          // group key
          const keyCol = groupByCols.includes(sel.name) ? sel.name : sel.expr;
          aggregated[sel.name] = groupRows[0][keyCol];
        } else {
          aggregated[sel.name] = this.aggregateExpr(groupRows, sel.expr);
        }
      }

      result.push(aggregated);
    }

    return result;
  }

  private aggregateExpr(rows: Array<Record<string, any>>, expr: string): any {
    const s = this.normalizeExpr(expr);
    const compact = s.toLowerCase().replace(/\s+/g, '');

    // count(*)
    if (compact.startsWith('count(*)')) return rows.length;

    const fnMatch = compact.match(/^([a-z_][a-z0-9_]*)\(([^)]*)\)$/i);
    if (!fnMatch) {
      // 非聚合列：取第一个值
      return rows[0]?.[expr];
    }

    const fn = fnMatch[1].toLowerCase();
    const colName = fnMatch[2].trim();

    const values = colName === '*' ? [] : rows.map((r) => Number(r[colName]));

    switch (fn) {
      case 'count':
        return colName === '*' ? rows.length : values.filter((v) => Number.isFinite(v)).length;
      case 'sum':
        return values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
      case 'avg': {
        const good = values.filter((v) => Number.isFinite(v));
        if (good.length === 0) return NaN;
        return good.reduce((a, b) => a + b, 0) / good.length;
      }
      case 'min': {
        let m = Infinity;
        for (const v of values) if (Number.isFinite(v) && v < m) m = v;
        return m === Infinity ? NaN : m;
      }
      case 'max': {
        let m = -Infinity;
        for (const v of values) if (Number.isFinite(v) && v > m) m = v;
        return m === -Infinity ? NaN : m;
      }
      case 'first':
        return rows[0]?.[colName];
      case 'last':
        return rows[rows.length - 1]?.[colName];
      case 'variance':
      case 'var': {
        const good = values.filter((v) => Number.isFinite(v));
        const n = good.length;
        if (n <= 1) return 0;
        const mean = good.reduce((a, b) => a + b, 0) / n;
        let sumSq = 0;
        for (const v of good) sumSq += (v - mean) * (v - mean);
        return sumSq / (n - 1);
      }
      case 'stddev':
      case 'std': {
        const good = values.filter((v) => Number.isFinite(v));
        const n = good.length;
        if (n <= 1) return 0;
        const mean = good.reduce((a, b) => a + b, 0) / n;
        let sumSq = 0;
        for (const v of good) sumSq += (v - mean) * (v - mean);
        return Math.sqrt(sumSq / (n - 1));
      }
      default:
        // 非聚合列：取第一个
        return rows[0]?.[colName];
    }
  }

  // ---------------------------------------------------------------------------
  // ORDER BY
  // ---------------------------------------------------------------------------

  private executeOrderBy(rows: Array<Record<string, any>>, orderBy: { column: string; direction: 'ASC' | 'DESC' }[]): Array<Record<string, any>> {
    return rows.sort((a, b) => {
      for (const { column, direction } of orderBy) {
        const valA = a[column];
        const valB = b[column];

        const cmp = this.compareValues(valA, valB);
        if (cmp !== 0) return direction === 'ASC' ? cmp : -cmp;
      }
      return 0;
    });
  }

  // ---------------------------------------------------------------------------
  // INSERT / UPSERT
  // ---------------------------------------------------------------------------

  private executeInsert(insert: any): number {
    const table = this.getTable(insert.into);
    if (!table) throw new Error(`Table not found: ${insert.into}`);

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

  private executeUpsert(upsert: SQLUpsert): number {
    const table = this.getTable(upsert.into);
    if (!table) throw new Error(`Table not found: ${upsert.into}`);

    const keyIndex = this.buildKeyIndex(table, upsert.conflictColumns);

    let inserted = 0;
    let updated = 0;

    for (const values of upsert.values) {
      const row: Record<string, any> = {};
      upsert.columns.forEach((col, i) => {
        row[col] = values[i];
      });

      const key = this.makeKey(row, upsert.conflictColumns);
      const existingIndex = keyIndex.get(key);

      if (existingIndex !== undefined) {
        const updateData: Record<string, any> = {};
        for (const col of upsert.updateColumns) {
          updateData[col] = row[col];
        }
        table.updateRow(existingIndex, updateData);
        updated++;
      } else {
        table.append(row);
        keyIndex.set(key, table.getRowCount() - 1);
        inserted++;
      }
    }

    return inserted + updated;
  }

  private buildKeyIndex(table: ColumnarTable, keyColumns: string[]): Map<string, number> {
    const index = new Map<string, number>();
    const rowCount = table.getRowCount();

    const keyArrays = keyColumns.map((col) => table.getColumn(col));

    for (let i = 0; i < rowCount; i++) {
      const keyParts: string[] = [];
      for (let j = 0; j < keyColumns.length; j++) {
        const arr = keyArrays[j];
        if (arr) keyParts.push(String((arr as any)[i]));
      }
      index.set(keyParts.join('|'), i);
    }

    return index;
  }

  private makeKey(row: Record<string, any>, keyColumns: string[]): string {
    return keyColumns.map((col) => String(row[col])).join('|');
  }

  // 推断列名 (简化)
  private inferColumnNames(_table: ColumnarTable): string[] {
    return ['timestamp', 'symbol', 'price', 'volume'];
  }
}
