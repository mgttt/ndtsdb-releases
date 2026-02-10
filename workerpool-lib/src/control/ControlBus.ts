/**
 * 控制信号总线 - Workpool Lib
 * 
 * 基于文件系统的信号传递机制
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { ControlSignal, ControlState } from '../core/Worker';

export interface ControlBus {
  // Coordinator -> Worker
  sendSignal(workerId: string, signal: ControlSignal, reason?: string): void;
  readSignal(workerId: string): ControlState | null;
  
  // Worker -> Coordinator
  ackSignal(workerId: string, canStopAt?: Date): void;
  readAck(workerId: string): AckInfo | null;
  
  // 清理
  clearSignal(workerId: string): void;
}

export interface AckInfo {
  status: 'ACKED' | 'REJECTED' | 'TIMEOUT';
  timestamp: string;
  canStopAt?: string;
}

export class FileControlBus implements ControlBus {
  private controlDir: string;
  private ackDir: string;

  constructor(basePath: string) {
    this.controlDir = join(basePath, 'control');
    this.ackDir = join(basePath, 'ack');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!existsSync(this.controlDir)) mkdirSync(this.controlDir, { recursive: true });
    if (!existsSync(this.ackDir)) mkdirSync(this.ackDir, { recursive: true });
  }

  sendSignal(workerId: string, signal: ControlSignal, reason?: string): void {
    const state: ControlState = {
      signal,
      signalTime: new Date().toISOString(),
      reason
    };
    
    const path = join(this.controlDir, `${workerId}.json`);
    this.atomicWrite(path, state);
  }

  readSignal(workerId: string): ControlState | null {
    const path = join(this.controlDir, `${workerId}.json`);
    return this.readJson(path);
  }

  ackSignal(workerId: string, canStopAt?: Date): void {
    const ack: AckInfo = {
      status: 'ACKED',
      timestamp: new Date().toISOString(),
      canStopAt: canStopAt?.toISOString()
    };
    
    const path = join(this.ackDir, `${workerId}.json`);
    this.atomicWrite(path, ack);
  }

  readAck(workerId: string): AckInfo | null {
    const path = join(this.ackDir, `${workerId}.json`);
    return this.readJson(path);
  }

  clearSignal(workerId: string): void {
    const controlPath = join(this.controlDir, `${workerId}.json`);
    const ackPath = join(this.ackDir, `${workerId}.json`);
    
    try { if (existsSync(controlPath)) unlinkSync(controlPath); } catch {}
    try { if (existsSync(ackPath)) unlinkSync(ackPath); } catch {}
  }

  listPendingSignals(): string[] {
    // 返回有待处理信号的 workerId 列表
    // 用于 coordinator 批量检查
    try {
      return require('fs').readdirSync(this.controlDir)
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  private atomicWrite(path: string, data: any): void {
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    require('fs').renameSync(tmpPath, path);
  }

  private readJson<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }
}
