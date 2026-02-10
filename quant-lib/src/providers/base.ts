/**
 * 数据提供者基类
 * 
 * 所有数据源（Binance、TradingView、Investing等）都继承这个基类
 * 实现统一的接口规范
 */

import { EventEmitter } from 'events';
import type { Kline, KlineQuery } from '../types/kline';
import type { ProviderConfig, Exchange, AssetType } from '../types/common';

/**
 * 数据提供者基类
 */
export abstract class DataProvider extends EventEmitter {
  protected config: ProviderConfig;
  protected isConnected: boolean = false;
  
  constructor(config: ProviderConfig) {
    super();
    this.config = config;
  }
  
  /**
   * 提供者名称
   */
  abstract get name(): string;
  
  /**
   * 支持的交易所列表
   */
  abstract get supportedExchanges(): Exchange[];
  
  /**
   * 支持的资产类型
   */
  abstract get supportedAssetTypes(): AssetType[];
  
  /**
   * 连接到数据源（WebSocket 数据源需要实现）
   */
  async connect(): Promise<void> {
    this.isConnected = true;
    this.emit('connected');
  }
  
  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    // 停止自动重连（关键修复！）
    this.shouldReconnect = false;

    this.isConnected = false;
    this.emit('disconnected');
  }
  
  /**
   * 获取K线数据（核心方法）
   * @param query - K线查询参数
   * @returns K线数组
   */
  abstract getKlines(query: KlineQuery): Promise<Kline[]>;
  
  /**
   * 批量获取K线数据
   * @param symbols - 符号列表
   * @param interval - 时间周期
   * @param limit - 返回数量
   * @returns Map<symbol, Kline[]>
   */
  async batchGetKlines(
    symbols: string[],
    interval: string,
    limit?: number
  ): Promise<Map<string, Kline[]>> {
    const results = new Map<string, Kline[]>();
    
    for (const symbol of symbols) {
      try {
        const klines = await this.getKlines({ symbol, interval, limit });
        results.set(symbol, klines);
        
        // 避免触发速率限制
        await this.delay(100);
      } catch (error) {
        console.error(`❌ ${symbol} 获取失败:`, error);
        results.set(symbol, []);
      }
    }
    
    return results;
  }
  
  /**
   * 订阅实时K线（WebSocket 数据源需要实现）
   * @param symbol - 符号
   * @param interval - 时间周期
   */
  subscribeRealtime?(symbol: string, interval: string): void;
  
  /**
   * 取消订阅
   * @param symbol - 符号
   */
  unsubscribe?(symbol: string): void;
  
  /**
   * 获取最新价格
   * @param symbol - 符号
   * @returns 当前价格
   */
  async getLatestPrice(symbol: string): Promise<number | null> {
    const klines = await this.getKlines({ symbol, interval: '1m', limit: 1 });
    if (klines.length === 0) return null;
    return klines[0].close;
  }
  
  /**
   * 检查符号是否支持
   * @param symbol - 符号
   * @returns 是否支持
   */
  abstract isSymbolSupported(symbol: string): Promise<boolean>;
  
  /**
   * 标准化符号（不同交易所的符号格式不同）
   * @param symbol - 原始符号
   * @returns 标准化符号 (BTC/USDT 格式)
   */
  abstract normalizeSymbol(symbol: string): string;
  
  /**
   * 转换为交易所特定符号
   * @param symbol - 标准化符号 (BTC/USDT)
   * @returns 交易所符号 (如 BTCUSDT)
   */
  abstract toExchangeSymbol(symbol: string): string;
  
  /**
   * 延迟函数
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 解析代理配置
   */
  protected getProxyUrl(): string | undefined {
    const proxy = this.config.proxy;
    if (!proxy) return undefined;
    
    if (typeof proxy === 'string') {
      return proxy;
    }
    
    if (proxy.url) {
      if (proxy.username && proxy.password) {
        const url = new URL(proxy.url);
        url.username = proxy.username;
        url.password = proxy.password;
        return url.toString();
      }
      return proxy.url;
    }
    
    return undefined;
  }
  
  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      // 尝试获取一个已知符号的数据
      const klines = await this.getKlines({
        symbol: 'BTC/USDT',
        interval: '1m',
        limit: 1
      });
      return klines.length > 0;
    } catch (error) {
      return false;
    }
  }
}

/**
 * REST API 数据提供者基类
 */
export abstract class RestDataProvider extends DataProvider {
  /**
   * 构建完整的 URL
   */
  protected abstract buildUrl(endpoint: string, params?: Record<string, any>): string;
  
  /**
   * 发送 HTTP 请求
   */
  protected abstract request<T = any>(
    method: string,
    endpoint: string,
    params?: Record<string, any>,
    data?: any
  ): Promise<T>;
}

/**
 * WebSocket 数据提供者基类
 */
export abstract class WebSocketDataProvider extends DataProvider {
  protected ws: any | null = null;
  protected reconnectAttempts = 0;
  protected maxReconnectAttempts = 5;
  protected heartbeatInterval: NodeJS.Timeout | null = null;
  protected shouldReconnect: boolean = true;  // 控制是否自动重连
  
  /**
   * WebSocket URL
   */
  protected abstract get wsUrl(): string;
  
  /**
   * 发送消息
   */
  protected abstract send(message: any): void;
  
  /**
   * 处理接收到的消息
   */
  protected abstract handleMessage(message: any): void;
  
  /**
   * 启动心跳
   */
  protected abstract startHeartbeat(): void;
  
  /**
   * 停止心跳
   */
  protected stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  /**
   * 重连
   */
  protected async attemptReconnect(): Promise<void> {
    // 检查是否应该重连（disconnect() 会设置为 false）
    if (!this.shouldReconnect) {
      console.log('⏹️  已手动断开连接，停止重连');
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`⏳ ${delay/1000}秒后重连 (尝试 ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      await this.delay(delay);
      // delay 期间可能发生了手动 disconnect；这里必须再次检查
      if (!this.shouldReconnect) {
        console.log('⏹️  已手动断开连接，停止重连');
        return;
      }
      await this.connect();
    } else {
      console.error('❌ 达到最大重连次数，停止重连');
      this.emit('reconnect_failed');
    }
  }
  
  async disconnect(): Promise<void> {
    // 停止自动重连（关键修复！）
    this.shouldReconnect = false;

    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    await super.disconnect();
  }
}
