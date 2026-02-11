// ============================================================
// ResourceMonitor - 进程资源监控
//
// 采集子进程的 CPU 和内存使用情况
// Linux: /proc/<pid>/stat, /proc/<pid>/status
// macOS: ps 命令
// ============================================================

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { platform } from 'os';

/**
 * 进程资源使用情况
 */
export interface ResourceUsage {
  pid: number;
  cpu: number;      // CPU 使用率 %
  memory: number;   // 内存使用 bytes
  memoryPercent: number; // 内存占系统总内存 %
  uptime: number;   // 运行时间 ms
  timestamp: number;
}

/**
 * 资源监控器
 */
export class ResourceMonitor {
  private isLinux: boolean;
  private cpuTotalCache: Map<number, { utime: number; stime: number; timestamp: number }> = new Map();

  constructor() {
    this.isLinux = platform() === 'linux';
  }

  /**
   * 获取单个进程的资源使用
   */
  async getUsage(pid: number): Promise<ResourceUsage | null> {
    if (this.isLinux) {
      return this.getUsageLinux(pid);
    } else {
      return this.getUsageUnix(pid);
    }
  }

  /**
   * Linux: 读 /proc/<pid>/stat
   */
  private getUsageLinux(pid: number): ResourceUsage | null {
    try {
      // 检查进程是否存在
      if (!existsSync(`/proc/${pid}`)) {
        return null;
      }

      // 读取 stat 文件
      const statPath = `/proc/${pid}/stat`;
      const statContent = readFileSync(statPath, 'utf-8');
      const statParts = statContent.split(' ');

      // 读取启动时间 (第 22 个字段)
      const starttime = parseInt(statParts[21], 10);

      // 读取进程启动以来的 CPU tick 数
      const utime = parseInt(statParts[13], 10);  // 用户态时间
      const stime = parseInt(statParts[14], 10);  // 内核态时间

      // 读取内存信息
      const statusPath = `/proc/${pid}/status`;
      let memory = 0;

      if (existsSync(statusPath)) {
        const statusContent = readFileSync(statusPath, 'utf-8');
        const vmRssMatch = statusContent.match(/VmRSS:\s+(\d+)\s+kB/);
        if (vmRssMatch) {
          memory = parseInt(vmRssMatch[1], 10) * 1024; // 转换为 bytes
        }
      }

      // 计算 CPU 使用率
      const cpu = this.calculateCpu(pid, utime, stime);

      // 计算运行时间（简化计算，实际应该用系统启动时间 + starttime）
      const uptime = this.calculateUptime(starttime);

      return {
        pid,
        cpu,
        memory,
        memoryPercent: 0, // 简化实现
        uptime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 非 Linux 系统：使用 ps 命令
   */
  private async getUsageUnix(pid: number): Promise<ResourceUsage | null> {
    try {
      // 使用 ps 命令获取进程信息
      const cmd = `ps -p ${pid} -o pid,pcpu,rss,etime`;
      const output = execSync(cmd, { encoding: 'utf-8' });
      const lines = output.trim().split('\n');

      if (lines.length < 2) {
        return null;
      }

      const parts = lines[1].trim().split(/\s+/);
      if (parts.length < 4) {
        return null;
      }

      const cpu = parseFloat(parts[1]) || 0;
      const rss = parseInt(parts[2], 10) || 0; // KB
      const etime = parts[3]; // elapsed time like "02:15:30" or "15:30"

      return {
        pid,
        cpu,
        memory: rss * 1024,
        memoryPercent: 0,
        uptime: this.parseElapsedTime(etime),
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 计算 CPU 使用率
   */
  private calculateCpu(pid: number, utime: number, stime: number): number {
    const now = Date.now();
    const prev = this.cpuTotalCache.get(pid);

    if (!prev) {
      // 第一次采集，保存数据
      this.cpuTotalCache.set(pid, { utime, stime, timestamp: now });
      return 0;
    }

    // 计算时间差（转换为秒）
    const timeDelta = (now - prev.timestamp) / 1000;
    if (timeDelta <= 0) return 0;

    // 计算 CPU tick 差
    // 注意：这里简化处理，实际应该用 sysconf(_SC_CLK_TCK) 获取 tick 频率
    const utimeDelta = utime - prev.utime;
    const stimeDelta = stime - prev.stime;

    // 更新缓存
    this.cpuTotalCache.set(pid, { utime, stime, timestamp: now });

    // 计算 CPU 使用率（假设 tick 频率为 100）
    // CPU% = (user_time + sys_time) / elapsed_time / num_cores * 100
    const cpuUsage = ((utimeDelta + stimeDelta) / 100) / timeDelta * 100;

    return Math.min(Math.max(cpuUsage, 0), 100 * this.getCpuCount());
  }

  /**
   * 获取 CPU 核心数
   */
  private getCpuCount(): number {
    try {
      return require('os').cpus().length;
    } catch {
      return 1;
    }
  }

  /**
   * 计算进程运行时间（简化版）
   */
  private calculateUptime(starttime: number): number {
    // 简化：假设无法准确计算，返回 0
    // 实际应该读取 /proc/stat 的 btime + starttime / HZ
    return 0;
  }

  /**
   * 解析 ps 输出的 elapsed time
   * 格式: [[dd-]hh:]mm:ss
   */
  private parseElapsedTime(etime: string): number {
    const parts = etime.split(/[-:]/);
    
    if (parts.length === 3) {
      // hh:mm:ss
      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      const seconds = parseInt(parts[2], 10) || 0;
      return (hours * 3600 + minutes * 60 + seconds) * 1000;
    } else if (parts.length === 4) {
      // dd-hh:mm:ss
      const days = parseInt(parts[0], 10) || 0;
      const hours = parseInt(parts[1], 10) || 0;
      const minutes = parseInt(parts[2], 10) || 0;
      const seconds = parseInt(parts[3], 10) || 0;
      return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
    } else if (parts.length === 2) {
      // mm:ss
      const minutes = parseInt(parts[0], 10) || 0;
      const seconds = parseInt(parts[1], 10) || 0;
      return (minutes * 60 + seconds) * 1000;
    }

    return 0;
  }

  /**
   * 清理缓存（进程停止后调用）
   */
  clearCache(pid: number): void {
    this.cpuTotalCache.delete(pid);
  }

  /**
   * 批量获取多个进程的资源使用
   */
  async getUsages(pids: number[]): Promise<Map<number, ResourceUsage>> {
    const results = new Map<number, ResourceUsage>();

    for (const pid of pids) {
      const usage = await this.getUsage(pid);
      if (usage) {
        results.set(pid, usage);
      }
    }

    return results;
  }

  /**
   * 检查进程是否存在
   */
  isRunning(pid: number): boolean {
    try {
      // 发送信号 0 检查进程是否存在
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

export default ResourceMonitor;
