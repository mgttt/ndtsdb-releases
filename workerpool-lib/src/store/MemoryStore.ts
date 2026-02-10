/**
 * 内存存储实现 - 用于测试
 */

import type { Store, Resource, Work, ResourceFilter, WorkFilter, ControlSignal, AckInfo } from '../core/types';

export class MemoryStore implements Store {
  private resources = new Map<string, Resource>();
  private works = new Map<string, Work>();
  private controlSignals = new Map<string, ControlSignal>();
  private acks = new Map<string, AckInfo>();

  async saveResource<R extends Resource>(resource: R): Promise<void> {
    this.resources.set(resource.id, resource);
  }

  async getResource<R extends Resource>(id: string): Promise<R | null> {
    return this.resources.get(id) as R || null;
  }

  async listResources<R extends Resource>(filter?: ResourceFilter): Promise<R[]> {
    let resources = Array.from(this.resources.values()) as R[];
    
    if (filter) {
      resources = resources.filter(r => {
        if (filter.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          if (!statuses.includes(r.state.status)) return false;
        }
        if (filter.capabilities?.length) {
          if (!filter.capabilities.some(c => r.capabilities.includes(c))) return false;
        }
        if (filter.available && !(r.state.status === 'idle' && r.load < r.capacity)) {
          return false;
        }
        if (filter.type && r.meta?.type !== filter.type) return false;
        return true;
      });
    }
    
    return resources;
  }

  async deleteResource(id: string): Promise<void> {
    this.resources.delete(id);
  }

  async saveWork<W extends Work>(work: W): Promise<void> {
    this.works.set(work.id, work);
  }

  async getWork<W extends Work>(id: string): Promise<W | null> {
    return this.works.get(id) as W || null;
  }

  async listWorks<W extends Work>(filter?: WorkFilter): Promise<W[]> {
    let works = Array.from(this.works.values()) as W[];
    
    if (filter) {
      works = works.filter(w => {
        let status: string;
        if (w.lifecycle.completed) status = 'completed';
        else if (w.lifecycle.started) status = 'running';
        else if (w.lifecycle.assigned) status = 'assigned';
        else status = 'pending';
        
        if (filter.status && status !== filter.status) return false;
        if (filter.assignedTo && w.lifecycle.assigned?.resourceId !== filter.assignedTo) return false;
        if (filter.priorityMin && w.priority < filter.priorityMin) return false;
        return true;
      });
    }
    
    return works;
  }

  async deleteWork(id: string): Promise<void> {
    this.works.delete(id);
  }

  async saveControlSignal(resourceId: string, signal: ControlSignal): Promise<void> {
    this.controlSignals.set(resourceId, signal);
  }

  async getControlSignal(resourceId: string): Promise<ControlSignal | null> {
    return this.controlSignals.get(resourceId) || null;
  }

  async saveAck(resourceId: string, ack: AckInfo): Promise<void> {
    this.acks.set(resourceId, ack);
  }

  async getAck(resourceId: string): Promise<AckInfo | null> {
    return this.acks.get(resourceId) || null;
  }

  // 测试辅助方法
  clear(): void {
    this.resources.clear();
    this.works.clear();
    this.controlSignals.clear();
    this.acks.clear();
  }
}
