/**
 * 文件存储实现
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import type { Store, Resource, Work, ResourceFilter, WorkFilter, ControlSignal, AckInfo } from '../core/types';

export class FileStore implements Store {
  readonly basePath: string;  // 暴露给外部使用
  private resourcesDir: string;
  private worksDir: string;
  private controlDir: string;
  private ackDir: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.resourcesDir = join(basePath, 'resources');
    this.worksDir = join(basePath, 'works');
    this.controlDir = join(basePath, 'control');
    this.ackDir = join(basePath, 'ack');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    [this.resourcesDir, this.worksDir, this.controlDir, this.ackDir].forEach(dir => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    });
  }

  // ========== 原子写入 ==========
  private atomicWrite(path: string, data: any): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  }

  private readJson<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  // ========== Resource ==========
  async saveResource<R extends Resource>(resource: R): Promise<void> {
    this.atomicWrite(join(this.resourcesDir, `${resource.id}.json`), resource);
  }

  async getResource<R extends Resource>(id: string): Promise<R | null> {
    return this.readJson<R>(join(this.resourcesDir, `${id}.json`));
  }

  async listResources<R extends Resource>(filter?: ResourceFilter): Promise<R[]> {
    try {
      const files = readdirSync(this.resourcesDir).filter(f => f.endsWith('.json'));
      let resources = files
        .map(f => this.readJson<R>(join(this.resourcesDir, f)))
        .filter((r): r is R => r !== null);
      
      if (filter) {
        resources = resources.filter(r => this.matchResource(r, filter));
      }
      
      return resources;
    } catch {
      return [];
    }
  }

  async deleteResource(id: string): Promise<void> {
    const path = join(this.resourcesDir, `${id}.json`);
    if (existsSync(path)) unlinkSync(path);
  }

  private matchResource<R extends Resource>(r: R, filter: ResourceFilter): boolean {
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!statuses.includes(r.state.status)) return false;
    }
    if (filter.capabilities && filter.capabilities.length > 0) {
      const hasCapability = filter.capabilities.some(c => r.capabilities.includes(c));
      if (!hasCapability) return false;
    }
    if (filter.available && !(r.state.status === 'idle' && r.load < r.capacity)) {
      return false;
    }
    if (filter.type && r.meta?.type !== filter.type) {
      return false;
    }
    return true;
  }

  // ========== Work ==========
  async saveWork<W extends Work>(work: W): Promise<void> {
    this.atomicWrite(join(this.worksDir, `${work.id}.json`), work);
  }

  async getWork<W extends Work>(id: string): Promise<W | null> {
    return this.readJson<W>(join(this.worksDir, `${id}.json`));
  }

  async listWorks<W extends Work>(filter?: WorkFilter): Promise<W[]> {
    try {
      const files = readdirSync(this.worksDir).filter(f => f.endsWith('.json'));
      let works = files
        .map(f => this.readJson<W>(join(this.worksDir, f)))
        .filter((w): w is W => w !== null);
      
      if (filter) {
        works = works.filter(w => this.matchWork(w, filter));
      }
      
      return works;
    } catch {
      return [];
    }
  }

  async deleteWork(id: string): Promise<void> {
    const path = join(this.worksDir, `${id}.json`);
    if (existsSync(path)) unlinkSync(path);
  }

  private matchWork<W extends Work>(w: W, filter: WorkFilter): boolean {
    // 简化状态判断
    let status: string;
    if (w.lifecycle.completed) status = 'completed';
    else if (w.lifecycle.started) status = 'running';
    else if (w.lifecycle.assigned) status = 'assigned';
    else status = 'pending';
    
    if (filter.status && status !== filter.status) return false;
    if (filter.assignedTo && w.lifecycle.assigned?.resourceId !== filter.assignedTo) return false;
    if (filter.priorityMin && w.priority < filter.priorityMin) return false;
    return true;
  }

  // ========== Control ==========
  async saveControlSignal(resourceId: string, signal: ControlSignal): Promise<void> {
    this.atomicWrite(join(this.controlDir, `${resourceId}.json`), {
      signal,
      timestamp: new Date().toISOString()
    });
  }

  async getControlSignal(resourceId: string): Promise<ControlSignal | null> {
    const data = this.readJson<{signal: ControlSignal}>(join(this.controlDir, `${resourceId}.json`));
    return data?.signal || null;
  }

  async saveAck(resourceId: string, ack: AckInfo): Promise<void> {
    this.atomicWrite(join(this.ackDir, `${resourceId}.json`), ack);
  }

  async getAck(resourceId: string): Promise<AckInfo | null> {
    return this.readJson<AckInfo>(join(this.ackDir, `${resourceId}.json`));
  }
}
