// ============================================================
// LogManager - 日志捕获和管理（零外部依赖）
//
// - stdout / stderr 分开捕获
// - tail / follow
// - 按大小轮转（gzip 压缩）
// ============================================================

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  truncateSync,
  unlinkSync,
  type WriteStream,
} from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { LogRotator } from './LogRotator';

export interface LogManagerConfig {
  logsDir: string;
  maxSize?: string; // e.g. "50M"
  retain?: number;
  injectTimestamp?: boolean;
}

export interface LogStreams {
  stdout: WriteStream;
  stderr: WriteStream;
}

export class LogManager {
  private config: Required<LogManagerConfig>;
  private streams = new Map<string, LogStreams>();
  private rotating = new Set<string>();

  constructor(config: LogManagerConfig) {
    this.config = {
      maxSize: '50M',
      retain: 5,
      injectTimestamp: true,
      ...config,
    };
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.config.logsDir)) {
      mkdirSync(this.config.logsDir, { recursive: true });
    }
  }

  private parseSize(size: string): number {
    const m = size.trim().match(/^(\d+)([BKMG]?)$/i);
    if (!m) return 50 * 1024 * 1024;
    const n = parseInt(m[1], 10);
    const u = (m[2] || 'B').toUpperCase();
    const mul = u === 'G' ? 1024 ** 3 : u === 'M' ? 1024 ** 2 : u === 'K' ? 1024 : 1;
    return n * mul;
  }

  paths(name: string): { out: string; err: string } {
    return {
      out: join(this.config.logsDir, `${name}-out.log`),
      err: join(this.config.logsDir, `${name}-err.log`),
    };
  }

  setup(name: string): LogStreams {
    this.close(name);

    const { out, err } = this.paths(name);
    const stdout = createWriteStream(out, { flags: 'a' });
    const stderr = createWriteStream(err, { flags: 'a' });

    const streams = { stdout, stderr };
    this.streams.set(name, streams);
    return streams;
  }

  getStreams(name: string): LogStreams | undefined {
    return this.streams.get(name);
  }

  close(name: string): void {
    const s = this.streams.get(name);
    if (s) {
      s.stdout.end();
      s.stderr.end();
      this.streams.delete(name);
    }
  }

  write(name: string, type: 'out' | 'err', data: string): void {
    const s = this.streams.get(name);
    if (!s) return;

    const stream = type === 'out' ? s.stdout : s.stderr;
    const text = data.toString();

    if (this.config.injectTimestamp) {
      const ts = new Date().toISOString();
      for (const line of text.split('\n')) {
        if (line.length === 0) continue;
        stream.write(`[${ts}] ${line}\n`);
      }
    } else {
      stream.write(text);
    }

    // fire-and-forget rotation check
    this.checkRotation(name).catch(() => {});
  }

  private async checkRotation(name: string): Promise<void> {
    const { out, err } = this.paths(name);
    const maxBytes = this.parseSize(this.config.maxSize);

    const tasks: Array<Promise<void>> = [];

    if (existsSync(out)) {
      const size = statSync(out).size;
      if (size > maxBytes) tasks.push(this.rotate(name, 'out'));
    }

    if (existsSync(err)) {
      const size = statSync(err).size;
      if (size > maxBytes) tasks.push(this.rotate(name, 'err'));
    }

    await Promise.all(tasks);
  }

  async rotate(name: string, type: 'out' | 'err'): Promise<void> {
    const key = `${name}:${type}`;
    if (this.rotating.has(key)) return;
    this.rotating.add(key);

    try {
      const { out, err } = this.paths(name);
      const sourcePath = type === 'out' ? out : err;
      const targetPrefix = join(this.config.logsDir, `${name}-${type}`);

      // close current stream for this file to flush buffer
      const s = this.streams.get(name);
      if (s) {
        const stream = type === 'out' ? s.stdout : s.stderr;
        await new Promise<void>(res => stream.end(() => res()));

        // reopen immediately (so process logging continues)
        const reopened = createWriteStream(sourcePath, { flags: 'a' });
        if (type === 'out') s.stdout = reopened;
        else s.stderr = reopened;
      }

      if (existsSync(sourcePath)) {
        await LogRotator.rotateAndCompress(sourcePath, targetPrefix, { retain: this.config.retain });
      }
    } finally {
      this.rotating.delete(key);
    }
  }

  rotateManual(name: string): Promise<void> {
    return Promise.all([this.rotate(name, 'out'), this.rotate(name, 'err')]).then(() => {});
  }

  tail(name: string, lines = 50, which: 'out' | 'err' | 'both' = 'both'): string[] {
    const { out, err } = this.paths(name);
    const buf: string[] = [];

    const takeLast = (content: string, prefix: string) => {
      const ls = content.split('\n').filter(Boolean);
      const last = ls.slice(-lines);
      buf.push(...last.map(l => `${prefix} ${l}`));
    };

    if ((which === 'out' || which === 'both') && existsSync(out)) {
      try { takeLast(readFileSync(out, 'utf-8'), '[OUT]'); } catch {}
    }

    if ((which === 'err' || which === 'both') && existsSync(err)) {
      try { takeLast(readFileSync(err, 'utf-8'), '[ERR]'); } catch {}
    }

    return buf.slice(-lines);
  }

  async *follow(name: string, which: 'out' | 'err' | 'both' = 'both', pollMs = 200): AsyncIterable<string> {
    const { out, err } = this.paths(name);

    if (which === 'out') {
      if (existsSync(out)) yield* this.followFile(out, '[OUT]', pollMs);
      return;
    }

    if (which === 'err') {
      if (existsSync(err)) yield* this.followFile(err, '[ERR]', pollMs);
      return;
    }

    // both: naive sequential follow (CLI 一般选 -f + --err / default out)
    if (existsSync(out)) yield* this.followFile(out, '[OUT]', pollMs);
    if (existsSync(err)) yield* this.followFile(err, '[ERR]', pollMs);
  }

  private async *followFile(filePath: string, prefix: string, pollMs: number): AsyncIterable<string> {
    let pos = 0;
    try {
      pos = statSync(filePath).size; // start at end
    } catch {
      pos = 0;
    }

    while (true) {
      await new Promise(r => setTimeout(r, pollMs));

      let size = 0;
      try {
        size = statSync(filePath).size;
      } catch {
        continue;
      }

      if (size < pos) {
        // rotated/truncated
        pos = 0;
      }

      if (size === pos) continue;

      const stream = createReadStream(filePath, { encoding: 'utf-8', start: pos, end: size });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (line.length > 0) yield `${prefix} ${line}`;
      }
      pos = size;
    }
  }

  clear(name: string): void {
    const { out, err } = this.paths(name);
    try { if (existsSync(out)) truncateSync(out, 0); } catch {}
    try { if (existsSync(err)) truncateSync(err, 0); } catch {}
  }

  remove(name: string): void {
    this.close(name);
    const { out, err } = this.paths(name);

    try { if (existsSync(out)) unlinkSync(out); } catch {}
    try { if (existsSync(err)) unlinkSync(err); } catch {}

    for (let i = 1; i <= this.config.retain; i++) {
      const outGz = join(this.config.logsDir, `${name}-out.${i}.log.gz`);
      const errGz = join(this.config.logsDir, `${name}-err.${i}.log.gz`);
      try { if (existsSync(outGz)) unlinkSync(outGz); } catch {}
      try { if (existsSync(errGz)) unlinkSync(errGz); } catch {}
    }
  }
}

export default LogManager;
