/**
 * Binance REST API 数据提供者
 * 
 * 特点：
 * - ✅ 完全免费，无需认证
 * - ✅ 官方 API，稳定可靠
 * - ✅ 速率限制宽松（1200请求/分钟）
 * - ✅ 支持所有加密货币对
 * - ✅ 支持代理（HTTP 451 地区限制需使用代理）
 */

import { RestDataProvider } from './base';
import type { Kline, KlineQuery } from '../types/kline';
import type { ProviderConfig, Exchange, AssetType } from '../types/common';
import { NetworkError, RateLimitError } from '../types/common';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface BinanceProviderConfig extends Partial<ProviderConfig> {
  /** 代理地址（可选） */
  proxy?: string;
  
  /** 超时时间（毫秒，默认10秒） */
  timeout?: number;
  
  /** 是否使用 Testnet */
  testnet?: boolean;
}

/**
 * Binance 原始 K线响应格式
 */
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

export class BinanceProvider extends RestDataProvider {
  private baseUrl: string;
  private proxyUrl?: string;
  private proxyAgent?: HttpsProxyAgent<string>; // HttpsProxyAgent
  private timeout: number;
  
  constructor(config: BinanceProviderConfig = {}) {
    super({
      name: 'Binance',
      proxy: config.proxy,
      ...config
    });
    
    this.baseUrl = config.testnet
      ? 'https://testnet.binance.vision/api/v3'
      : 'https://api.binance.com/api/v3';
    
    this.proxyUrl = config.proxy || process.env.HTTP_PROXY;
    
    // 创建 HttpsProxyAgent（如果配置了代理）
    if (this.proxyUrl) {
      this.proxyAgent = new HttpsProxyAgent(this.proxyUrl);
      console.log(`  🌐 Binance 使用代理: ${this.proxyUrl}`);
    }
    
    this.timeout = config.timeout || 10000;
  }
  
  get name(): string {
    return 'Binance';
  }
  
  get supportedExchanges(): Exchange[] {
    return ['BINANCE'];
  }
  
  get supportedAssetTypes(): AssetType[] {
    return ['SPOT', 'FUTURES', 'PERPETUAL'];
  }
  
  /**
   * 获取 K线数据（支持自动分页）
   */
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    const { symbol, interval, limit = 1000, startTime, endTime } = query;
    
    // 如果 limit <= 1000，单次请求即可
    if (limit <= 1000) {
      return this.fetchKlinesBatch(symbol, interval, limit, startTime, endTime);
    }
    
    // 否则，分批拉取
    console.log(`  📦 分批拉取 ${limit} 条 (每批 1000)`);
    
    const allKlines: Kline[] = [];
    let remaining = limit;
    let currentEndTime = endTime; // Unix 秒：从最新时间开始向前拉取
    
    while (remaining > 0) {
      const batchLimit = Math.min(remaining, 1000);
      const batch = await this.fetchKlinesBatch(
        symbol,
        interval,
        batchLimit,
        startTime,
        currentEndTime
      );
      
      if (batch.length === 0) break; // 没有更多数据
      
      allKlines.push(...batch);
      remaining -= batch.length;
      
      // 更新 endTime 为这一批最早的时间戳（继续向前拉取）
      const earliestTs = Math.min(...batch.map(k => k.timestamp));
      currentEndTime = earliestTs - 1; // 秒时间戳，减 1s 避免重复
      
      // 避免触发速率限制
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // 按时间戳升序排序（Binance 返回的是倒序）
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
    // 转换符号格式：BTC/USDT → BTCUSDT
    const exchangeSymbol = this.toExchangeSymbol(symbol);
    
    // 构建请求参数
    const params: Record<string, any> = {
      symbol: exchangeSymbol,
      interval: this.convertInterval(interval),
      limit
    };
    
    // KlineQuery 统一用「Unix 秒」，Binance REST 需要毫秒
    if (startTime) params.startTime = startTime * 1000;
    if (endTime) params.endTime = endTime * 1000;
    
    try {
      const rawData = await this.request<BinanceKlineRaw[]>('GET', '/klines', params);
      return this.transformKlines(rawData, symbol, interval);
    } catch (error: any) {
      if (error.statusCode === 429) {
        throw new RateLimitError('Binance API 速率限制', error.retryAfter);
      }
      throw new NetworkError(`获取 ${symbol} K线失败: ${error.message}`, error);
    }
  }
  
  /**
   * 批量获取K线（优化版）
   */
  async batchGetKlines(
    symbols: string[],
    interval: string,
    limit?: number
  ): Promise<Map<string, Kline[]>> {
    console.log(`📊 Binance - 开始获取 ${symbols.length} 个币种的 ${interval} K线数据`);
    const results = await super.batchGetKlines(symbols, interval, limit);
    console.log(`✅ Binance - 成功获取 ${results.size}/${symbols.length} 个币种`);
    return results;
  }
  
  /**
   * 检查符号是否支持
   */
  async isSymbolSupported(symbol: string): Promise<boolean> {
    try {
      const exchangeSymbol = this.toExchangeSymbol(symbol);
      const info = await this.request('GET', '/exchangeInfo', { symbol: exchangeSymbol });
      return !!info;
    } catch {
      return false;
    }
  }
  
  /**
   * 标准化符号
   * BTCUSDT → BTC/USDT
   */
  normalizeSymbol(symbol: string): string {
    // 已经是标准格式
    if (symbol.includes('/')) return symbol;
    
    // BTCUSDT → BTC/USDT
    if (symbol.endsWith('USDT')) {
      const base = symbol.replace('USDT', '');
      return `${base}/USDT`;
    }
    
    // BTCUSD → BTC/USD
    if (symbol.endsWith('USD')) {
      const base = symbol.replace('USD', '');
      return `${base}/USD`;
    }
    
    // 默认假设 USDT 计价
    return `${symbol}/USDT`;
  }
  
  /**
   * 转换为交易所符号
   * BTC/USDT → BTCUSDT
   */
  toExchangeSymbol(symbol: string): string {
    // 已经是交易所格式
    if (!symbol.includes('/')) return symbol;
    
    // BTC/USDT → BTCUSDT
    return symbol.replace('/', '');
  }
  
  /**
   * 转换时间周期格式
   * 15m → 15m (Binance 原生支持)
   */
  private convertInterval(interval: string): string {
    // Binance 支持的周期与标准周期一致
    return interval;
  }
  
  /**
   * 转换原始 K线数据为统一格式
   */
  private transformKlines(raw: BinanceKlineRaw[], symbol: string, interval: string): Kline[] {
    return raw.map(k => {
      const normalized = this.normalizeSymbol(symbol);
      const [base, quote] = normalized.split('/');
      
      return {
        symbol: normalized,
        exchange: 'BINANCE',
        baseCurrency: base,
        quoteCurrency: quote,
        interval,
        timestamp: Math.floor(k[0]), // Binance 返回毫秒，保持不变
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        quoteVolume: parseFloat(k[7]),
        trades: k[8],
        takerBuyVolume: parseFloat(k[9]),
        takerBuyQuoteVolume: parseFloat(k[10])
      };
    });
  }
  
  /**
   * 构建完整 URL
   */
  protected buildUrl(endpoint: string, params?: Record<string, any>): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }
    
    return url.toString();
  }
  
  /**
   * 发送 HTTP 请求（支持代理）
   */
  protected async request<T = any>(
    method: string,
    endpoint: string,
    params?: Record<string, any>,
    data?: any
  ): Promise<T> {
    const url = this.buildUrl(endpoint, params);
    
    const options: RequestInit = {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Content-Type': 'application/json'
      }
    };
    
    // 设置代理（使用 HttpsProxyAgent）
    if (this.proxyAgent) {
      (options as any).agent = this.proxyAgent;
    }
    
    // 设置超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    options.signal = controller.signal;
    
    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.statusCode = response.status;
        
        // 解析速率限制
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          error.retryAfter = retryAfter ? parseInt(retryAfter) : undefined;
        }
        
        throw error;
      }
      
      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new NetworkError(`请求超时 (${this.timeout}ms)`);
      }
      
      throw error;
    }
  }
}
