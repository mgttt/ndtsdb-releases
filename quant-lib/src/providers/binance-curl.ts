/**
 * Binance REST API 数据提供者（curl 包装器版本）
 * 
 * 原因：Bun 的 fetch 不支持代理（即使设置 agent/dispatcher/环境变量）
 * 解决方案：使用 curl 作为底层传输层（curl 支持代理）
 * 
 * 特点：
 * - ✅ 完全免费，无需认证
 * - ✅ 官方 API，稳定可靠
 * - ✅ 速率限制宽松（1200请求/分钟）
 * - ✅ 支持所有加密货币对
 * - ✅ 代理支持（通过 curl）
 */

import { $ } from 'bun';
import { RestDataProvider } from './base';
import type { Kline, KlineQuery } from '../types/kline';
import type { ProviderConfig, Exchange } from '../types/common';
import { NetworkError, RateLimitError } from '../types/common';

export interface BinanceCurlProviderConfig extends Partial<ProviderConfig> {
  /** 代理地址（必需） */
  proxy: string;
  
  /** 超时时间（秒，默认10秒） */
  timeout?: number;
  
  /** 是否使用 Testnet */
  testnet?: boolean;
}

type BinanceKlineRaw = [
  number,   // 开盘时间
  string,   // 开盘价
  string,   // 最高价
  string,   // 最低价
  string,   // 收盘价
  string,   // 成交量
  number,   // 收盘时间
  string,   // 成交额
  number,   // 成交笔数
  string,   // 主动买入成交量
  string,   // 主动买入成交额
  string    // 忽略
];

export class BinanceCurlProvider extends RestDataProvider {
  private baseUrl: string;
  private proxy: string;
  private timeout: number;
  
  constructor(config: BinanceCurlProviderConfig) {
    super({
      name: 'Binance',
      ...config
    });
    
    this.baseUrl = config.testnet
      ? 'https://testnet.binance.vision/api/v3'
      : 'https://api.binance.com/api/v3';
    
    this.proxy = config.proxy;
    this.timeout = config.timeout || 10;
    
    console.log(`  🌐 Binance 使用代理（curl）: ${this.proxy}`);
  }
  
  get name(): string {
    return 'Binance';
  }
  
  get supportedExchanges(): Exchange[] {
    return ['BINANCE'];
  }
  
  /**
   * 获取 K线数据
   */
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    const { symbol, interval, limit = 1000, startTime, endTime } = query;
    
    // 如果 limit > 1000，分批拉取
    if (limit > 1000) {
      return this.getKlinesLarge(symbol, interval, limit, startTime, endTime);
    }
    
    return this.fetchKlinesBatch(symbol, interval, limit, startTime, endTime);
  }
  
  /**
   * 获取大量 K线数据（分批）
   */
  private async getKlinesLarge(
    symbol: string,
    interval: string,
    limit: number,
    startTime?: number,
    endTime?: number
  ): Promise<Kline[]> {
    const allKlines: Kline[] = [];
    let remaining = limit;
    let currentEndTime = endTime;
    
    while (remaining > 0) {
      const batchSize = Math.min(remaining, 1000);
      const batch = await this.fetchKlinesBatch(symbol, interval, batchSize, startTime, currentEndTime);
      
      if (batch.length === 0) break;
      
      allKlines.push(...batch);
      remaining -= batch.length;
      
      const earliestTs = Math.min(...batch.map(k => k.timestamp));
      currentEndTime = Math.floor(earliestTs / 1000) - 1; // 毫秒 → 秒
      
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return allKlines.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  /**
   * 获取单批 K线数据（limit <= 1000）
   */
  private async fetchKlinesBatch(
    symbol: string,
    interval: string,
    limit: number,
    startTime?: number,
    endTime?: number
  ): Promise<Kline[]> {
    const exchangeSymbol = this.toExchangeSymbol(symbol);
    const binanceInterval = this.convertInterval(interval);
    
    // 构建 URL
    let url = `${this.baseUrl}/klines?symbol=${exchangeSymbol}&interval=${binanceInterval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime * 1000}`;
    if (endTime) url += `&endTime=${endTime * 1000}`;
    
    try {
      // 使用 curl 发送请求（支持代理）
      const response = await $`curl -s --max-time ${this.timeout} --proxy ${this.proxy} ${url}`.text();
      
      const rawData: BinanceKlineRaw[] = JSON.parse(response);
      
      // 检查是否是错误响应
      if (!Array.isArray(rawData)) {
        const error: any = rawData;
        if (error.code) {
          throw new Error(`Binance API error ${error.code}: ${error.msg}`);
        }
        throw new Error('Invalid response format');
      }
      
      return this.transformKlines(rawData, symbol, interval);
    } catch (error: any) {
      if (error.message?.includes('429')) {
        throw new RateLimitError('Binance API 速率限制');
      }
      throw new NetworkError(`获取 ${symbol} K线失败: ${error.message}`, error);
    }
  }
  
  /**
   * 转换 K线数据
   */
  private transformKlines(rawData: BinanceKlineRaw[], symbol: string, interval: string): Kline[] {
    const normalized = this.normalizeSymbol(symbol);
    const [base, quote] = normalized.split('/');
    
    return rawData.map(k => ({
      symbol: normalized,
      exchange: 'BINANCE' as Exchange,
      baseCurrency: base,
      quoteCurrency: quote,
      interval,
      timestamp: k[0], // Binance 返回毫秒时间戳
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]),
      trades: k[8],
      takerBuyVolume: parseFloat(k[9]),
      takerBuyQuoteVolume: parseFloat(k[10])
    }));
  }
  
  /**
   * 标准化符号：BTCUSDT → BTC/USDT
   */
  normalizeSymbol(symbol: string): string {
    if (symbol.includes('/')) return symbol;
    
    if (symbol.endsWith('USDT')) {
      const base = symbol.replace('USDT', '');
      return `${base}/USDT`;
    }
    
    if (symbol.endsWith('USD')) {
      const base = symbol.replace('USD', '');
      return `${base}/USD`;
    }
    
    return `${symbol}/USDT`;
  }
  
  /**
   * 转换为交易所符号：BTC/USDT → BTCUSDT
   */
  toExchangeSymbol(symbol: string): string {
    return symbol.replace('/', '');
  }
  
  /**
   * 转换时间间隔格式：15m → 15m (Binance 格式相同)
   */
  private convertInterval(interval: string): string {
    // Binance 支持：1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
    return interval;
  }
  
  /**
   * Dummy implementation (not needed for curl-based provider)
   */
  protected async request<T = any>(
    method: string,
    endpoint: string,
    params?: Record<string, any>,
    data?: any
  ): Promise<T> {
    throw new Error('request() not implemented for BinanceCurlProvider - use curl directly');
  }
}
