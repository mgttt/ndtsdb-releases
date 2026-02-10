/**
 * Binance Client
 * 
 * Public data API for Binance (no authentication required)
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { DataProvider, Kline, KlineQuery, ProviderConfig } from '../types/index';
import { NetworkError, RateLimitError, ProviderError } from '../types/index';
import { createLogger } from '../utils/logger';

const logger = createLogger('BinanceClient');

export interface BinanceConfig extends ProviderConfig {
  testnet?: boolean;
}

export class BinanceClient implements DataProvider {
  name = 'binance';
  private config: Required<BinanceConfig>;
  private proxyAgent?: any;
  private connected = false;
  private baseUrl: string;

  constructor(config: BinanceConfig = {}) {
    this.config = {
      timeout: 10000,
      retries: 3,
      retryDelay: 1000,
      testnet: false,
      ...config,
    };

    this.baseUrl = this.config.testnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';

    if (this.config.proxy) {
      this.proxyAgent = new ProxyAgent(this.config.proxy);
    }
  }

  async connect(): Promise<void> {
    this.connected = true;
    logger.info('Connected to Binance');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('Disconnected from Binance');
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async request(endpoint: string, params?: Record<string, any>): Promise<any> {
    const url = new URL(`/fapi/v1${endpoint}`, this.baseUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const response = await undiciFetch(url.toString(), {
          method: 'GET',
          dispatcher: this.proxyAgent,
        });

        if (response.status === 429) {
          throw new RateLimitError('Rate limit exceeded', 60);
        }

        if (!response.ok) {
          throw new ProviderError(`HTTP ${response.status}`, String(response.status));
        }

        return await response.json();
      } catch (error: any) {
        lastError = error;

        if (error.name === 'RateLimitError') {
          logger.warn('Rate limited, waiting 60s');
          await this.sleep(60000);
        } else if (attempt < this.config.retries - 1) {
          logger.warn(`Request failed, retrying (${attempt + 1}/${this.config.retries})`);
          await this.sleep(this.config.retryDelay * (attempt + 1));
        } else {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get klines
   */
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    // Format symbol for Binance (BTCUSDT instead of BTC/USDT)
    const symbol = query.symbol.replace('/', '');

    // KlineQuery 统一用「Unix 秒」，Binance REST 需要毫秒
    const result = await this.request('/klines', {
      symbol,
      interval: query.interval,
      startTime: query.startTime ? query.startTime * 1000 : undefined,
      endTime: query.endTime ? query.endTime * 1000 : undefined,
      limit: query.limit || 1000,
    });

    return result.map((item: any[]) => ({
      timestamp: Math.floor(item[0] / 1000),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
      quoteVolume: parseFloat(item[7]),
      trades: item[8],
      takerBuyVolume: parseFloat(item[9]),
      takerBuyQuoteVolume: parseFloat(item[10]),
      symbol: query.symbol,
      interval: query.interval,
    }));
  }

  /**
   * Get exchange info
   */
  async getExchangeInfo(): Promise<any> {
    return this.request('/exchangeInfo');
  }

  /**
   * Get 24hr ticker
   */
  async get24hrTicker(symbol?: string): Promise<any> {
    const params: any = {};
    if (symbol) params.symbol = symbol.replace('/', '');
    return this.request('/ticker/24hr', params);
  }

  /**
   * Get all symbols
   */
  async getSymbols(): Promise<string[]> {
    const info = await this.getExchangeInfo();
    return info.symbols
      .filter((s: any) => s.status === 'TRADING')
      .map((s: any) => s.symbol);
  }
}
