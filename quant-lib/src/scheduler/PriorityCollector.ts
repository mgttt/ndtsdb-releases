/**
 * 优先级采集调度器
 * 
 * 功能：
 * 1. 根据股票重要性分配 API 额度
 * 2. 优先采集持仓、关注列表、行业龙头
 * 3. 额度不足时自动跳过低优先级股票
 * 
 * 使用：
 * ```typescript
 * const collector = new PriorityCollector(cache, {
 *   dailyQuota: 500,
 *   quotaReserve: 100,
 * });
 * 
 * // 添加股票
 * collector.addStock('700/HKD', StockPriority.CRITICAL); // 持仓
 * collector.addStock('9988/HKD', StockPriority.HIGH);    // 关注列表
 * 
 * // 执行采集
 * await collector.collect({ interval: '1d', days: 30 });
 * ```
 */

import type { SmartKlineCache } from '../cache/SmartKlineCache.js';

export enum StockPriority {
  /** 持仓股票（每小时更新） */
  CRITICAL = 1,
  
  /** 关注列表（每日更新） */
  HIGH = 2,
  
  /** 行业龙头（每周更新） */
  MEDIUM = 3,
  
  /** 普通股票（每月更新） */
  LOW = 4,
}

export interface StockItem {
  symbol: string;
  priority: StockPriority;
  lastUpdate?: number; // 上次更新时间戳
}

export interface CollectorConfig {
  /** 每日总额度 */
  dailyQuota: number;
  
  /** 预留额度（紧急使用） */
  quotaReserve?: number;
  
  /** 是否显示进度 */
  verbose?: boolean;
}

export interface CollectOptions {
  /** 时间周期 */
  interval: string;
  
  /** 采集天数（从今天往前） */
  days: number;
}

export class PriorityCollector {
  private cache: SmartKlineCache;
  private config: CollectorConfig;
  private stocks: Map<string, StockItem> = new Map();
  private quotaUsed = 0;
  
  constructor(cache: SmartKlineCache, config: CollectorConfig) {
    this.cache = cache;
    this.config = {
      quotaReserve: 100,
      verbose: true,
      ...config,
    };
  }
  
  /**
   * 添加股票到采集列表
   */
  addStock(symbol: string, priority: StockPriority): void {
    this.stocks.set(symbol, { symbol, priority });
  }
  
  /**
   * 批量添加股票
   */
  addStocks(items: Array<{ symbol: string; priority: StockPriority }>): void {
    for (const item of items) {
      this.addStock(item.symbol, item.priority);
    }
  }
  
  /**
   * 从文件加载股票列表
   */
  loadFromFile(filePath: string): void {
    // TODO: 从 JSON/CSV 文件加载
  }
  
  /**
   * 执行优先级采集
   */
  async collect(options: CollectOptions): Promise<void> {
    const { interval, days } = options;
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - days * 86400;
    
    // 按优先级分组
    const grouped = this.groupByPriority();
    
    // 可用额度
    const availableQuota = this.config.dailyQuota - (this.config.quotaReserve || 0);
    
    if (this.config.verbose) {
      console.log('\n🎯 优先级采集调度器');
      console.log('━'.repeat(60));
      console.log(`  总额度: ${this.config.dailyQuota}`);
      console.log(`  预留额度: ${this.config.quotaReserve}`);
      console.log(`  可用额度: ${availableQuota}`);
      console.log(`  总股票数: ${this.stocks.size}`);
      console.log('━'.repeat(60));
    }
    
    // 逐级采集
    for (const priority of [StockPriority.CRITICAL, StockPriority.HIGH, StockPriority.MEDIUM, StockPriority.LOW]) {
      const stocks = grouped.get(priority) || [];
      if (stocks.length === 0) continue;
      
      const priorityName = this.getPriorityName(priority);
      const remaining = availableQuota - this.quotaUsed;
      
      if (this.config.verbose) {
        console.log(`\n📌 ${priorityName} (${stocks.length} 只)`);
        console.log(`   剩余额度: ${remaining}`);
      }
      
      // 额度不足，跳过低优先级
      if (remaining <= 0) {
        if (this.config.verbose) {
          console.log(`   ⚠️  额度不足，跳过`);
        }
        continue;
      }
      
      // 采集股票
      let collected = 0;
      for (const stock of stocks) {
        if (this.quotaUsed >= availableQuota) {
          if (this.config.verbose) {
            console.log(`   ⚠️  额度用尽，停止采集`);
          }
          break;
        }
        
        try {
          const klines = await this.cache.getKlines({
            symbol: stock.symbol,
            interval,
            startTime,
            endTime,
          });
          
          // 统计 API 调用（通过缓存统计）
          const statsBefore = this.cache.getStats();
          this.quotaUsed = statsBefore.fullRequests + statsBefore.incrementalRequests;
          
          collected++;
          stock.lastUpdate = Date.now();
          
          if (this.config.verbose) {
            console.log(`   ✅ ${stock.symbol}: ${klines.length} 根 K线`);
          }
        } catch (error: any) {
          if (this.config.verbose) {
            console.log(`   ❌ ${stock.symbol}: ${error.message}`);
          }
        }
      }
      
      if (this.config.verbose) {
        console.log(`   已采集: ${collected}/${stocks.length}`);
      }
    }
    
    // 打印统计
    if (this.config.verbose) {
      console.log('\n📊 采集完成');
      console.log('━'.repeat(60));
      console.log(`  已用额度: ${this.quotaUsed}/${availableQuota}`);
      console.log(`  剩余额度: ${availableQuota - this.quotaUsed}`);
      this.cache.printStats();
    }
  }
  
  /**
   * 按优先级分组
   */
  private groupByPriority(): Map<StockPriority, StockItem[]> {
    const groups = new Map<StockPriority, StockItem[]>();
    
    for (const stock of this.stocks.values()) {
      const group = groups.get(stock.priority) || [];
      group.push(stock);
      groups.set(stock.priority, group);
    }
    
    return groups;
  }
  
  /**
   * 获取优先级名称
   */
  private getPriorityName(priority: StockPriority): string {
    switch (priority) {
      case StockPriority.CRITICAL:
        return 'CRITICAL（持仓）';
      case StockPriority.HIGH:
        return 'HIGH（关注）';
      case StockPriority.MEDIUM:
        return 'MEDIUM（龙头）';
      case StockPriority.LOW:
        return 'LOW（普通）';
      default:
        return 'UNKNOWN';
    }
  }
  
  /**
   * 重置已用额度
   */
  resetQuota(): void {
    this.quotaUsed = 0;
    this.cache.resetStats();
  }
  
  /**
   * 获取已用额度
   */
  getQuotaUsed(): number {
    return this.quotaUsed;
  }
  
  /**
   * 获取剩余额度
   */
  getRemainingQuota(): number {
    const availableQuota = this.config.dailyQuota - (this.config.quotaReserve || 0);
    return Math.max(0, availableQuota - this.quotaUsed);
  }
}
