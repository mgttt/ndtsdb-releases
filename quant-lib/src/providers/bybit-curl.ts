/**
 * Bybit REST API 数据提供者（curl 包装器版本）
 * 
 * 原因：与 BinanceCurlProvider 类似，Bun fetch 代理支持不佳
 * 解决方案：使用 curl 作为底层传输层
 * 
 * 特点：
 * - ✅ 公开 K线接口，无需 API key
 * - ✅ 官方 V5 API，稳定可靠
 * - ✅ 支持现货、永续、交割合约
 * - ✅ 代理支持（通过 curl）
 */

import { $ } from 'bun';
import { RestDataProvider } from './base';
import type { Kline, KlineQuery } from '../types/kline';
import type { ProviderConfig, Exchange } from '../types/common';
import { NetworkError, RateLimitError } from '../types/common';

export interface BybitCurlProviderConfig extends Partial<ProviderConfig> {
  /** 代理地址（必需） */
  proxy: string;
  
  /** 超时时间（秒，默认10秒） */
  timeout?: number;
  
  /** API 基础 URL（默认 https://api.bybit.com） */
  baseUrl?: string;
  
  /** 合约类型（spot, linear, inverse），默认 spot */
  category?: 'spot' | 'linear' | 'inverse';
}

/**
 * Bybit K线响应格式
 * [timestamp, open, high, low, close, volume, turnover]
 */
type BybitKlineRaw = [
  string,   // 开盘时间（毫秒）
  string,   // 开盘价
  string,   // 最高价
  string,   // 最低价
  string,   // 收盘价
  string,   // 成交量
  string    // 成交额
];

interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    symbol: string;
    list: BybitKlineRaw[];
  };
  retExtInfo: any;
  time: number;
}

export class BybitCurlProvider extends RestDataProvider {
  private baseUrl: string;
  private proxy: string;
  private timeout: number;
  private category: 'spot' | 'linear' | 'inverse';
  
  constructor(config: BybitCurlProviderConfig) {
    super({
      name: 'Bybit',
      ...config
    });
    
    this.baseUrl = config.baseUrl || 'https://api.bybit.com';
    this.proxy = config.proxy;
    this.timeout = config.timeout || 10;
    this.category = config.category || 'spot';
    
    console.log(`  🌐 Bybit 使用代理（curl）: ${this.proxy}`);
  }
  
  get name(): string {
    return 'Bybit';
  }
  
  get supportedExchanges(): Exchange[] {
    return ['BYBIT'];
  }
  
  /**
   * 获取 K线数据
   */
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    const { symbol, interval, limit = 1000, startTime, endTime } = query;
    
    // Bybit 限制：最多 1000 条/次
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
      
      // Bybit 返回时间戳是毫秒
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
    const bybitInterval = this.convertInterval(interval);
    
    // 构建 URL
    let url = `${this.baseUrl}/v5/market/kline?category=${this.category}&symbol=${exchangeSymbol}&interval=${bybitInterval}&limit=${limit}`;
    
    // Bybit 接受毫秒时间戳
    if (startTime) url += `&start=${startTime * 1000}`;
    if (endTime) url += `&end=${endTime * 1000}`;
    
    try {
      // 使用 curl 发送请求（支持代理）
      const response = await $`curl -sS --max-time ${this.timeout} --proxy ${this.proxy} ${url}`.text();
      
      const data: BybitKlineResponse = JSON.parse(response);
      
      // 检查 API 错误
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error ${data.retCode}: ${data.retMsg}`);
      }
      
      if (!data.result?.list) {
        return [];
      }
      
      return this.transformKlines(data.result.list, symbol, interval);
    } catch (error: any) {
      if (error.message?.includes('429') || error.message?.includes('rate limit')) {
        throw new RateLimitError('Bybit API 速率限制');
      }
      throw new NetworkError(`获取 ${symbol} K线失败: ${error.message}`, error);
    }
  }
  
  /**
   * 转换 K线数据
   */
  private transformKlines(rawData: BybitKlineRaw[], symbol: string, interval: string): Kline[] {
    const normalized = this.normalizeSymbol(symbol);
    const [base, quote] = normalized.split('/');
    
    return rawData.map(k => ({
      symbol: normalized,
      exchange: 'BYBIT' as Exchange,
      baseCurrency: base,
      quoteCurrency: quote,
      interval,
      timestamp: parseInt(k[0]), // Bybit 返回毫秒时间戳
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[6]),
      trades: 0, // Bybit K线接口不返回成交笔数
      takerBuyVolume: 0,
      takerBuyQuoteVolume: 0
    }));
  }
  
  /**
   * 标准化符号：BTCUSDT → BTC/USDT
   */
  normalizeSymbol(symbol: string): string {
    if (symbol.includes('/')) return symbol;
    
    // 永续合约后缀
    if (symbol.endsWith('PERP')) {
      const base = symbol.replace('PERP', '');
      return `${base}/USDT:USDT`; // 标准化为 CCXT 格式
    }
    
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
    // 处理永续合约格式：BTC/USDT:USDT → BTCUSDT (for linear perpetual)
    if (symbol.includes(':')) {
      const [pair] = symbol.split(':');
      return pair.replace('/', '');
    }
    return symbol.replace('/', '');
  }
  
  /**
   * 转换时间间隔格式
   * Bybit: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, W, M
   */
  private convertInterval(interval: string): string {
    const map: Record<string, string> = {
      '1m': '1',
      '3m': '3',
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '2h': '120',
      '4h': '240',
      '6h': '360',
      '12h': '720',
      '1d': 'D',
      '1w': 'W',
      '1M': 'M'
    };
    
    return map[interval] || interval;
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
    throw new Error('request() not implemented for BybitCurlProvider - use curl directly');
  }
}
