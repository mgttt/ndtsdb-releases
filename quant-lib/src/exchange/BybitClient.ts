/**
 * Unified Bybit Client
 * 
 * Trading + Data unified API for Bybit exchange
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { createHmac } from 'crypto';
import type { 
  ExchangeProvider, ExchangeConfig, Kline, KlineQuery, 
  Order, Position, Balance, OrderSide, AccountType,
  ProviderConfig 
} from '../types/index';
import { createLogger } from '../utils/logger';
import { NetworkError, RateLimitError, ProviderError } from '../types/index';

const logger = createLogger('BybitClient');

export interface BybitConfig extends ExchangeConfig, ProviderConfig {
  recvWindow?: number;
}

export class BybitClient implements ExchangeProvider {
  name = 'bybit';
  private config: Required<BybitConfig>;
  private proxyAgent?: any;
  private connected = false;
  private baseUrl: string;

  constructor(config: BybitConfig) {
    this.config = {
      timeout: 10000,
      retries: 3,
      retryDelay: 1000,
      recvWindow: 5000,
      testnet: false,
      ...config,
    };

    this.baseUrl = this.config.testnet 
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';

    if (this.config.proxy) {
      this.proxyAgent = new ProxyAgent(this.config.proxy);
    }
  }

  /**
   * Test connection
   */
  async connect(): Promise<void> {
    try {
      await this.getBalance('UNIFIED');
      this.connected = true;
      logger.info('Connected to Bybit');
    } catch (error: any) {
      throw new ProviderError(`Failed to connect: ${error.message}`);
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('Disconnected from Bybit');
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Make authenticated request
   */
  private async request(
    method: string,
    endpoint: string,
    params?: Record<string, any>,
    signed = false
  ): Promise<any> {
    const url = new URL(endpoint, this.baseUrl);
    
    if (params && !signed) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    let body: string | undefined;

    // Add authentication
    if (signed) {
      const timestamp = Date.now();
      const recvWindow = this.config.recvWindow;
      
      const signParams = {
        api_key: this.config.credentials.key,
        timestamp: String(timestamp),
        recv_window: String(recvWindow),
        ...params,
      };

      // Create signature
      const signString = Object.keys(signParams)
        .sort()
        .map(k => `${k}=${signParams[k]}`)
        .join('&');

      const signature = createHmac('sha256', this.config.credentials.secret)
        .update(signString)
        .digest('hex');

      headers['X-BAPI-API-KEY'] = this.config.credentials.key;
      headers['X-BAPI-TIMESTAMP'] = String(timestamp);
      headers['X-BAPI-SIGN'] = signature;
      headers['X-BAPI-RECV-WINDOW'] = String(recvWindow);

      if (method === 'POST') {
        body = JSON.stringify(params);
      } else {
        for (const [key, value] of Object.entries(params || {})) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    // Retry logic
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const response = await undiciFetch(url.toString(), {
          method,
          headers,
          body,
          dispatcher: this.proxyAgent,
        });

        const data = await response.json() as any;

        if (data.retCode !== 0) {
          if (data.retCode === 10006) {
            throw new RateLimitError('Rate limit exceeded', 60);
          }
          throw new ProviderError(data.retMsg, String(data.retCode));
        }

        return data.result;
      } catch (error: any) {
        lastError = error;
        
        if (error.name === 'RateLimitError') {
          const delay = error.retryAfter || 60;
          logger.warn(`Rate limited, waiting ${delay}s`);
          await this.sleep(delay * 1000);
        } else if (this.isNetworkError(error) && attempt < this.config.retries - 1) {
          logger.warn(`Network error, retrying (${attempt + 1}/${this.config.retries})`);
          await this.sleep(this.config.retryDelay * (attempt + 1));
        } else {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private isNetworkError(error: any): boolean {
    const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'socket hang up'];
    return networkErrors.some(e => error.message?.includes(e));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================================
  // Data API (Public)
  // ============================================================================

  /**
   * Get klines/candles
   */
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    const result = await this.request('GET', '/v5/market/kline', {
      category: 'linear',
      symbol: query.symbol,
      interval: query.interval,
      start: query.startTime,
      end: query.endTime,
      limit: query.limit || 1000,
    });

    return result.list.map((item: any[]) => ({
      timestamp: parseInt(item[0]),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
      quoteVolume: parseFloat(item[6]),
      symbol: query.symbol,
      interval: query.interval,
    }));
  }

  /**
   * Get latest ticker
   */
  async getTicker(symbol: string): Promise<any> {
    return this.request('GET', '/v5/market/tickers', {
      category: 'linear',
      symbol,
    });
  }

  // ============================================================================
  // Trading API (Private)
  // ============================================================================

  /**
   * Get account balance
   */
  async getBalance(accountType: AccountType = 'UNIFIED'): Promise<Balance[]> {
    const result = await this.request('GET', '/v5/account/wallet-balance', {
      accountType,
    }, true);

    const balances: Balance[] = [];
    
    for (const account of result.list || []) {
      for (const coin of account.coin || []) {
        balances.push({
          asset: coin.coin,
          walletBalance: parseFloat(coin.walletBalance) || 0,
          availableBalance: parseFloat(coin.availableToWithdraw) || 0,
          unrealizedPnl: parseFloat(coin.unrealisedPnl) || 0,
          totalEquity: parseFloat(account.totalEquity) || 0,
        });
      }
    }

    return balances;
  }

  /**
   * Get positions
   */
  async getPositions(symbol?: string): Promise<Position[]> {
    const params: any = { category: 'linear' };
    if (symbol) params.symbol = symbol;

    const result = await this.request('GET', '/v5/position/list', params, true);

    return (result.list || []).map((p: any) => ({
      symbol: p.symbol,
      side: p.side === 'Buy' ? 'Buy' : 'Sell',
      size: parseFloat(p.size) || 0,
      entryPrice: parseFloat(p.avgPrice) || parseFloat(p.entryPrice) || 0,
      leverage: parseFloat(p.leverage) || 1,
      unrealizedPnl: parseFloat(p.unrealisedPnl) || 0,
      realizedPnl: parseFloat(p.curRealisedPnl) || 0,
    }));
  }

  /**
   * Place order
   */
  async placeOrder(order: Order): Promise<any> {
    const params: any = {
      category: 'linear',
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      qty: order.qty,
    };

    if (order.orderType === 'Limit') {
      params.price = order.price;
      params.timeInForce = order.timeInForce || 'GTC';
    }

    if (order.reduceOnly) {
      params.reduceOnly = true;
    }

    return this.request('POST', '/v5/order/create', params, true);
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol: string, orderId: string): Promise<any> {
    return this.request('POST', '/v5/order/cancel', {
      category: 'linear',
      symbol,
      orderId,
    }, true);
  }

  /**
   * Get open orders
   */
  async getOrders(symbol?: string): Promise<Order[]> {
    const params: any = { category: 'linear' };
    if (symbol) params.symbol = symbol;

    const result = await this.request('GET', '/v5/order/realtime', params, true);

    return (result.list || []).map((o: any) => ({
      orderId: o.orderId,
      symbol: o.symbol,
      side: o.side,
      orderType: o.orderType,
      qty: o.qty,
      price: o.price,
      timeInForce: o.timeInForce,
      reduceOnly: o.reduceOnly,
    }));
  }

  /**
   * Cancel all orders
   */
  async cancelAllOrders(symbol?: string): Promise<any> {
    const params: any = { category: 'linear' };
    if (symbol) params.symbol = symbol;

    return this.request('POST', '/v5/order/cancel-all', params, true);
  }
}
