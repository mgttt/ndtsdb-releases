// ============================================================
// SQL 解析器 - 支持时序数据库常用 SQL 子集
// 手写递归下降解析器，零依赖
// ============================================================

export type SQLValue = string | number | boolean | null;
export type SQLOperator = '=' | '!=' | '<>' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'IN';

export interface SQLCondition {
  column: string;
  operator: SQLOperator;
  value: SQLValue | SQLValue[];
  logic?: 'AND' | 'OR';  // 与下一个条件的逻辑关系
}

export interface SQLSelect {
  columns: Array<string | { expr: string; alias?: string }>;
  from: string;
  where?: SQLCondition[];
  groupBy?: string[];
  orderBy?: { column: string; direction: 'ASC' | 'DESC' }[];
  limit?: number;
  offset?: number;
}

export interface SQLInsert {
  into: string;
  columns: string[];
  values: SQLValue[][];
}

export interface SQLUpsert {
  into: string;
  columns: string[];
  values: SQLValue[][];
  conflictColumns: string[];  // ON CONFLICT (col1, col2, ...)
  updateColumns: string[];    // DO UPDATE SET col1=EXCLUDED.col1, ...
}

export interface SQLCreateTable {
  table: string;
  columns: Array<{
    name: string;
    type: string;
    constraints?: string[];
  }>;
}

export type SQLStatement = 
  | { type: 'SELECT'; data: SQLSelect }
  | { type: 'INSERT'; data: SQLInsert }
  | { type: 'UPSERT'; data: SQLUpsert }
  | { type: 'CREATE TABLE'; data: SQLCreateTable };

export class SQLParser {
  private sql: string = '';
  private pos: number = 0;
  private tokens: string[] = [];
  private tokenPos: number = 0;

  parse(sql: string): SQLStatement {
    this.sql = sql.trim();
    this.pos = 0;
    this.tokens = this.tokenize(this.sql);
    this.tokenPos = 0;

    const firstToken = this.peek()?.toUpperCase();
    
    switch (firstToken) {
      case 'SELECT':
        return { type: 'SELECT', data: this.parseSelect() };
      case 'INSERT':
        return this.parseInsertOrUpsert();
      case 'UPSERT':
        return { type: 'UPSERT', data: this.parseUpsert() };
      case 'CREATE':
        return { type: 'CREATE TABLE', data: this.parseCreateTable() };
      default:
        throw new Error(`Unsupported SQL statement: ${firstToken}`);
    }
  }

  // 词法分析
  private tokenize(sql: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    
    while (i < sql.length) {
      const char = sql[i];
      
      // 跳过空白
      if (/\s/.test(char)) {
        i++;
        continue;
      }
      
      // 字符串
      if (char === "'" || char === '"') {
        const quote = char;
        let str = '';
        i++;
        while (i < sql.length && sql[i] !== quote) {
          if (sql[i] === '\\' && i + 1 < sql.length) {
            str += sql[i + 1];
            i += 2;
          } else {
            str += sql[i];
            i++;
          }
        }
        i++; // 跳过结束引号
        tokens.push(`'${str}'`);
        continue;
      }
      
      // 数字
      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(sql[i + 1]))) {
        let num = '';
        while (i < sql.length && (/[0-9.]/.test(sql[i]) || sql[i] === 'e' || sql[i] === 'E' || sql[i] === '+' || sql[i] === '-')) {
          num += sql[i];
          i++;
        }
        tokens.push(num);
        continue;
      }
      
      // 标识符或关键字
      if (/[a-zA-Z_]/.test(char)) {
        let ident = '';
        while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
          ident += sql[i];
          i++;
        }
        tokens.push(ident);
        continue;
      }
      
      // 操作符
      if (char === '!' && sql[i + 1] === '=') {
        tokens.push('!=');
        i += 2;
        continue;
      }
      if (char === '<' && sql[i + 1] === '=') {
        tokens.push('<=');
        i += 2;
        continue;
      }
      if (char === '>' && sql[i + 1] === '=') {
        tokens.push('>=');
        i += 2;
        continue;
      }
      if (char === '<' && sql[i + 1] === '>') {
        tokens.push('<>');
        i += 2;
        continue;
      }
      
      // 单字符 token
      tokens.push(char);
      i++;
    }
    
    return tokens;
  }

  // 解析 SELECT
  private parseSelect(): SQLSelect {
    this.consume('SELECT');
    
    const columns = this.parseSelectColumns();
    
    this.consume('FROM');
    const from = this.consumeIdentifier();
    
    let where: SQLCondition[] | undefined;
    if (this.peek()?.toUpperCase() === 'WHERE') {
      this.consume('WHERE');
      where = this.parseWhere();
    }
    
    let groupBy: string[] | undefined;
    if (this.peek()?.toUpperCase() === 'GROUP') {
      this.consume('GROUP');
      this.consume('BY');
      groupBy = this.parseIdentifierList();
    }
    
    let orderBy: { column: string; direction: 'ASC' | 'DESC' }[] | undefined;
    if (this.peek()?.toUpperCase() === 'ORDER') {
      this.consume('ORDER');
      this.consume('BY');
      orderBy = this.parseOrderBy();
    }
    
    let limit: number | undefined;
    if (this.peek()?.toUpperCase() === 'LIMIT') {
      this.consume('LIMIT');
      limit = parseInt(this.consume());
    }
    
    let offset: number | undefined;
    if (this.peek()?.toUpperCase() === 'OFFSET') {
      this.consume('OFFSET');
      offset = parseInt(this.consume());
    }
    
    return { columns, from, where, groupBy, orderBy, limit, offset };
  }

  // 解析 SELECT 列
  private parseSelectColumns(): Array<string | { expr: string; alias?: string }> {
    const columns: Array<string | { expr: string; alias?: string }> = [];
    
    if (this.peek() === '*') {
      this.consume('*');
      return ['*'];
    }
    
    while (true) {
      const col = this.parseColumnOrExpr();
      columns.push(col);
      
      if (this.peek() === ',') {
        this.consume(',');
        continue;
      }
      break;
    }
    
    return columns;
  }

  // 解析列或表达式
  private parseColumnOrExpr(): string | { expr: string; alias?: string } {
    const start = this.tokenPos;
    let expr = '';
    
    // 解析函数或列名
    while (this.tokenPos < this.tokens.length) {
      const token = this.peek();
      if (!token) break;
      
      const upper = token.toUpperCase();
      if (['FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', ','].includes(upper)) {
        break;
      }
      
      if (upper === 'AS') {
        this.consume('AS');
        const alias = this.consumeIdentifier();
        return { expr: expr.trim(), alias };
      }
      
      expr += this.consume() + ' ';
    }
    
    return expr.trim();
  }

  // 解析 WHERE 条件
  private parseWhere(): SQLCondition[] {
    const conditions: SQLCondition[] = [];
    
    while (true) {
      const column = this.consumeIdentifier();
      const operator = this.parseOperator();
      const value = this.parseValue();
      
      conditions.push({ column, operator, value });
      
      const logic = this.peek()?.toUpperCase();
      if (logic === 'AND' || logic === 'OR') {
        this.consume();
        conditions[conditions.length - 1].logic = logic as 'AND' | 'OR';
        continue;
      }
      
      break;
    }
    
    return conditions;
  }

  // 解析操作符
  private parseOperator(): SQLOperator {
    const op = this.consume().toUpperCase();
    const validOps: SQLOperator[] = ['=', '!=', '<>', '<', '>', '<=', '>=', 'LIKE', 'IN'];
    
    if (!validOps.includes(op as SQLOperator)) {
      throw new Error(`Invalid operator: ${op}`);
    }
    
    return op as SQLOperator;
  }

  // 解析值
  private parseValue(): SQLValue | SQLValue[] {
    const token = this.peek();
    
    if (token?.toUpperCase() === 'NULL') {
      this.consume('NULL');
      return null;
    }
    
    if (token === '(') {
      // IN (list)
      this.consume('(');
      const values: SQLValue[] = [];
      while (this.peek() !== ')') {
        values.push(this.parseSingleValue());
        if (this.peek() === ',') this.consume(',');
      }
      this.consume(')');
      return values;
    }
    
    return this.parseSingleValue();
  }

  private parseSingleValue(): SQLValue {
    const token = this.consume();
    
    if (token.startsWith("'") && token.endsWith("'")) {
      return token.slice(1, -1);
    }
    
    if (token.toUpperCase() === 'TRUE') return true;
    if (token.toUpperCase() === 'FALSE') return false;
    if (token.toUpperCase() === 'NULL') return null;
    
    const num = parseFloat(token);
    if (!isNaN(num)) return num;
    
    return token;
  }

  // 解析 ORDER BY
  private parseOrderBy(): { column: string; direction: 'ASC' | 'DESC' }[] {
    const orderBy: { column: string; direction: 'ASC' | 'DESC' }[] = [];
    
    while (true) {
      const column = this.consumeIdentifier();
      let direction: 'ASC' | 'DESC' = 'ASC';
      
      const next = this.peek()?.toUpperCase();
      if (next === 'ASC' || next === 'DESC') {
        direction = this.consume().toUpperCase() as 'ASC' | 'DESC';
      }
      
      orderBy.push({ column, direction });
      
      if (this.peek() === ',') {
        this.consume(',');
        continue;
      }
      break;
    }
    
    return orderBy;
  }

  // 解析 INSERT 或 INSERT ... ON CONFLICT (转为 UPSERT)
  private parseInsertOrUpsert(): SQLStatement {
    this.consume('INSERT');
    this.consume('INTO');
    
    const into = this.consumeIdentifier();
    
    let columns: string[] = [];
    if (this.peek() === '(') {
      this.consume('(');
      columns = this.parseIdentifierList();
      this.consume(')');
    }
    
    this.consume('VALUES');
    const values = this.parseValuesList();
    
    // 检查是否有 ON CONFLICT 子句
    if (this.peek()?.toUpperCase() === 'ON') {
      return { 
        type: 'UPSERT', 
        data: this.parseOnConflict(into, columns, values) 
      };
    }
    
    return { type: 'INSERT', data: { into, columns, values } };
  }

  // 解析 UPSERT INTO ... VALUES ...
  private parseUpsert(): SQLUpsert {
    this.consume('UPSERT');
    this.consume('INTO');
    
    const into = this.consumeIdentifier();
    
    let columns: string[] = [];
    if (this.peek() === '(') {
      this.consume('(');
      columns = this.parseIdentifierList();
      this.consume(')');
    }
    
    this.consume('VALUES');
    const values = this.parseValuesList();
    
    // UPSERT 语法必须指定主键列
    // UPSERT INTO table (col1, col2) VALUES (...) KEY (col1)
    let conflictColumns: string[] = [];
    if (this.peek()?.toUpperCase() === 'KEY') {
      this.consume('KEY');
      this.consume('(');
      conflictColumns = this.parseIdentifierList();
      this.consume(')');
    } else {
      // 默认：第一列作为主键
      conflictColumns = columns.length > 0 ? [columns[0]] : [];
    }
    
    // 更新所有非主键列
    const updateColumns = columns.filter(c => !conflictColumns.includes(c));
    
    return { into, columns, values, conflictColumns, updateColumns };
  }

  // 解析 ON CONFLICT (...) DO UPDATE SET ...
  private parseOnConflict(into: string, columns: string[], values: SQLValue[][]): SQLUpsert {
    this.consume('ON');
    this.consume('CONFLICT');
    
    // 解析冲突列
    this.consume('(');
    const conflictColumns = this.parseIdentifierList();
    this.consume(')');
    
    this.consume('DO');
    this.consume('UPDATE');
    this.consume('SET');
    
    // 解析 SET 子句 (col=EXCLUDED.col, ...)
    const updateColumns: string[] = [];
    while (true) {
      const col = this.consumeIdentifier();
      this.consume('=');
      
      // 期望 EXCLUDED.col
      const excluded = this.consumeIdentifier();
      if (excluded.toUpperCase() !== 'EXCLUDED') {
        throw new Error(`Expected EXCLUDED.column, got: ${excluded}`);
      }
      this.consume('.');
      const targetCol = this.consumeIdentifier();
      
      updateColumns.push(col);
      
      if (this.peek() === ',') {
        this.consume(',');
        continue;
      }
      break;
    }
    
    return { into, columns, values, conflictColumns, updateColumns };
  }

  // 解析值列表
  private parseValuesList(): SQLValue[][] {
    const allValues: SQLValue[][] = [];
    
    while (true) {
      this.consume('(');
      const row: SQLValue[] = [];
      
      while (this.peek() !== ')') {
        row.push(this.parseSingleValue());
        if (this.peek() === ',') this.consume(',');
      }
      
      this.consume(')');
      allValues.push(row);
      
      if (this.peek() === ',') {
        this.consume(',');
        continue;
      }
      break;
    }
    
    return allValues;
  }

  // 解析 CREATE TABLE
  private parseCreateTable(): SQLCreateTable {
    this.consume('CREATE');
    this.consume('TABLE');
    
    const table = this.consumeIdentifier();
    
    this.consume('(');
    const columns: SQLCreateTable['columns'] = [];
    
    while (this.peek() !== ')') {
      const name = this.consumeIdentifier();
      const type = this.consumeIdentifier();
      
      const constraints: string[] = [];
      while (this.peek() && ![')', ','].includes(this.peek())) {
        constraints.push(this.consume().toUpperCase());
      }
      
      columns.push({ name, type, constraints: constraints.length > 0 ? constraints : undefined });
      
      if (this.peek() === ',') this.consume(',');
    }
    
    this.consume(')');
    
    return { table, columns };
  }

  // 辅助方法
  private peek(): string | undefined {
    return this.tokens[this.tokenPos];
  }

  private consume(expected?: string): string {
    const token = this.tokens[this.tokenPos];
    if (!token) {
      throw new Error(`Unexpected end of SQL, expected: ${expected}`);
    }
    
    if (expected && token.toUpperCase() !== expected.toUpperCase()) {
      throw new Error(`Expected ${expected}, got ${token}`);
    }
    
    this.tokenPos++;
    return token;
  }

  private consumeIdentifier(): string {
    const token = this.consume();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) {
      throw new Error(`Expected identifier, got ${token}`);
    }
    return token;
  }

  private parseIdentifierList(): string[] {
    const list: string[] = [];
    while (true) {
      list.push(this.consumeIdentifier());
      if (this.peek() === ',') {
        this.consume(',');
        continue;
      }
      break;
    }
    return list;
  }
}

// 便捷函数
export function parseSQL(sql: string): SQLStatement {
  return new SQLParser().parse(sql);
}
