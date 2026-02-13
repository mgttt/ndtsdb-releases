/**
 * JournalStore — JSONL append-only storage with file locking
 * 
 * Designed for conversation sessions: each key maps to a .jsonl file
 * where entries are appended one per line. Supports concurrent access
 * via FileLock.
 * 
 * Built on the same atomic-write pattern as FileStore.
 */

import {
  readFileSync, appendFileSync, writeFileSync, existsSync,
  mkdirSync, readdirSync, statSync,
} from 'fs';
import { join } from 'path';
import { FileLock } from '../lock/FileLock';

export interface JournalEntry {
  [key: string]: any;
}

export interface JournalMeta {
  key: string;
  lines: number;
  lastModified: string;
  sizeBytes: number;
}

export class JournalStore {
  readonly baseDir: string;
  private lockDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.lockDir = join(baseDir, '.locks');
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
    if (!existsSync(this.lockDir)) mkdirSync(this.lockDir, { recursive: true });
  }

  /** Append an entry (one JSON line) to a journal */
  append(key: string, entry: JournalEntry): void {
    const path = this.keyPath(key);
    const lock = this.acquireLock(key);
    try {
      appendFileSync(path, JSON.stringify(entry) + '\n');
    } finally {
      lock.release();
    }
  }

  /** Read all entries from a journal */
  read(key: string): JournalEntry[] {
    const path = this.keyPath(key);
    if (!existsSync(path)) return [];

    const lock = this.acquireLock(key);
    try {
      return this.parseLines(readFileSync(path, 'utf-8'));
    } finally {
      lock.release();
    }
  }

  /** Read the last N entries */
  readRecent(key: string, n: number): JournalEntry[] {
    const all = this.read(key);
    if (all.length <= n) return all;
    return all.slice(all.length - n);
  }

  /** Clear a journal (truncate to empty) */
  clear(key: string): void {
    const path = this.keyPath(key);
    if (!existsSync(path)) return;

    const lock = this.acquireLock(key);
    try {
      writeFileSync(path, '');
    } finally {
      lock.release();
    }
  }

  /** Rewrite a journal with new entries (for compaction) */
  rewrite(key: string, entries: JournalEntry[]): void {
    const path = this.keyPath(key);
    const lock = this.acquireLock(key);
    try {
      const content = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
      writeFileSync(path, content);
    } finally {
      lock.release();
    }
  }

  /** List all journal keys with metadata */
  list(): JournalMeta[] {
    if (!existsSync(this.baseDir)) return [];

    return readdirSync(this.baseDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const path = join(this.baseDir, f);
        const stat = statSync(path);
        const content = readFileSync(path, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim()).length;
        return {
          key: f.replace('.jsonl', ''),
          lines,
          lastModified: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        };
      })
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  }

  /** Check if a journal exists */
  has(key: string): boolean {
    return existsSync(this.keyPath(key));
  }

  /** Get line count without reading all data */
  lineCount(key: string): number {
    const path = this.keyPath(key);
    if (!existsSync(path)) return 0;
    const content = readFileSync(path, 'utf-8');
    return content.split('\n').filter(l => l.trim()).length;
  }

  // --- Internal ---

  private keyPath(key: string): string {
    return join(this.baseDir, `${key}.jsonl`);
  }

  private acquireLock(key: string): FileLock {
    const lock = new FileLock(this.lockDir, {
      lockName: key,
      timeoutMs: 10000,
    });
    const result = lock.acquire();
    if (!result.acquired) {
      throw new Error(`JournalStore: failed to acquire lock for "${key}": ${result.reason}`);
    }
    return lock;
  }

  private parseLines(content: string): JournalEntry[] {
    const entries: JournalEntry[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip corrupted lines
      }
    }
    return entries;
  }
}
