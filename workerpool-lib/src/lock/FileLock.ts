/**
 * 文件锁实现 - 支持多锁共存
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface LockInfo {
  pid: number;
  startTime: string;
  timeoutAt: string;
  instanceId: string;
  lockName: string;
}

export interface LockAcquireResult {
  acquired: boolean;
  isMine: boolean;
  previous?: LockInfo;
  reason?: string;
}

export interface FileLockOptions {
  lockName?: string;        // 锁名称，默认 'scheduler'
  timeoutMs?: number;       // 超时时间，默认 5 分钟
  lockDir?: string;         // 锁文件目录，默认 {basePath}/locks
}

export class FileLock {
  private lockPath: string;
  private lockName: string;
  private timeoutMs: number;
  private instanceId: string;

  constructor(basePath: string, options: FileLockOptions = {}) {
    this.lockName = options.lockName || 'scheduler';
    this.timeoutMs = options.timeoutMs || 300000;
    this.instanceId = `${process.pid}-${Date.now()}`;
    
    const lockDir = options.lockDir || join(basePath, 'locks');
    this.lockPath = join(lockDir, `${this.lockName}.lock`);
    
    // 确保目录存在
    const dir = dirname(this.lockPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 尝试获取锁
   */
  acquire(): LockAcquireResult {
    const existing = this.readLock();
    
    if (existing) {
      // 检查是否是自己的锁（重入）
      if (existing.instanceId === this.instanceId) {
        return { acquired: true, isMine: true };
      }

      // 检查是否超时
      const timeoutAt = new Date(existing.timeoutAt);
      const now = new Date();
      
      if (now < timeoutAt) {
        const remainingMs = timeoutAt.getTime() - now.getTime();
        return { 
          acquired: false, 
          isMine: false, 
          previous: existing,
          reason: `Lock '${this.lockName}' held by pid:${existing.pid}, ${Math.round(remainingMs/1000)}s remaining`
        };
      }

      // 超时抢占
      console.warn(`[Lock:${this.lockName}] Timeout! Previous: pid:${existing.pid}, started: ${existing.startTime}`);
      this.writeLock();
      return { 
        acquired: true, 
        isMine: false, 
        previous: existing, 
        reason: 'timeout-preempted' 
      };
    }

    // 无锁，直接获取
    this.writeLock();
    return { acquired: true, isMine: true };
  }

  /**
   * 释放锁
   */
  release(): boolean {
    const current = this.readLock();
    if (!current) return false;
    
    if (current.instanceId === this.instanceId) {
      try {
        unlinkSync(this.lockPath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * 续约（延长超时时间）
   */
  renew(additionalMs?: number): boolean {
    const current = this.readLock();
    if (!current || current.instanceId !== this.instanceId) {
      return false;
    }
    
    const newTimeout = new Date(Date.now() + (additionalMs || this.timeoutMs));
    this.writeLock(newTimeout);
    return true;
  }

  /**
   * 强制释放（清理孤儿锁）
   */
  forceRelease(): boolean {
    try {
      if (existsSync(this.lockPath)) {
        unlinkSync(this.lockPath);
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * 查询锁状态（不获取）
   */
  query(): LockInfo | null {
    return this.readLock();
  }

  /**
   * 获取锁名称
   */
  get name(): string {
    return this.lockName;
  }

  private readLock(): LockInfo | null {
    if (!existsSync(this.lockPath)) return null;
    try {
      return JSON.parse(readFileSync(this.lockPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private writeLock(timeoutAt?: Date): void {
    const info: LockInfo = {
      pid: process.pid,
      startTime: new Date().toISOString(),
      timeoutAt: (timeoutAt || new Date(Date.now() + this.timeoutMs)).toISOString(),
      instanceId: this.instanceId,
      lockName: this.lockName
    };
    
    // 原子写入
    const tmpPath = `${this.lockPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(info, null, 2));
    renameSync(tmpPath, this.lockPath);
  }
}
