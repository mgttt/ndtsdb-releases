// ============================================================
// CLI Table Formatter
// ============================================================

export interface TableColumn {
  key: string;
  header: string;
  width?: number;
  align?: 'left' | 'right';
}

export class Table {
  private columns: TableColumn[];
  private rows: Record<string, string>[] = [];

  constructor(columns: TableColumn[]) {
    this.columns = columns;
  }

  addRow(row: Record<string, string>): void {
    this.rows.push(row);
  }

  render(): string {
    // Calculate widths
    const widths = this.columns.map(col => {
      const headerLen = col.header.length;
      const maxDataLen = Math.max(...this.rows.map(r => (r[col.key] || '').length), 0);
      return col.width || Math.max(headerLen, maxDataLen) + 2;
    });

    // Header
    const headerLine = '│ ' + this.columns.map((col, i) => {
      const w = widths[i];
      return this.pad(col.header, w, 'left');
    }).join('│ ') + '│';

    const separator = '├' + widths.map(w => '─'.repeat(w + 1)).join('┼') + '┤';
    const topBorder = '┌' + widths.map(w => '─'.repeat(w + 1)).join('┬') + '┐';
    const bottomBorder = '└' + widths.map(w => '─'.repeat(w + 1)).join('┴') + '┘';

    // Rows
    const rowLines = this.rows.map(row => {
      return '│ ' + this.columns.map((col, i) => {
        const w = widths[i];
        const val = row[col.key] || '';
        return this.pad(val, w, col.align || 'left');
      }).join('│ ') + '│';
    });

    return [topBorder, headerLine, separator, ...rowLines, bottomBorder].join('\n');
  }

  private pad(str: string, width: number, align: 'left' | 'right'): string {
    if (str.length >= width) return str.slice(0, width);
    const spaces = ' '.repeat(width - str.length);
    return align === 'left' ? str + spaces : spaces + str;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}
