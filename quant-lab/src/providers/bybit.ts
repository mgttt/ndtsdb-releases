// ============================================================
// Bybit Trading Provider - 连接 Bybit 交易所
// ============================================================

import type {
  Order,
  Position,
  Account,
  Tick,
} from '../engine/types';
import type { Kline } from 'quant-lib';
import type { TradingProvider } from '../engine/live';
import { createHmac } from 'crypto';
import { execFileSync } from 'node:child_process';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

/**
 * Bybit 配置
 */
export interface BybitProviderConfig {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
  proxy?: string;
  category?: 'spot' | 'linear' | 'inverse';  // 产品类型
}

/**
 * Bybit K线响应
 */
interface BybitKlineData {
  topic: string;
  type: string;
  ts: number;
  data: Array<{
    start: number;
    end: number;
    interval: string;
    open: string;
    close: string;
    high: string;
    low: string;
    volume: string;
    turnover: string;
    confirm: boolean;
  }>;
}

/**
 * Bybit Trading Provider
 */
export class BybitProvider implements TradingProvider {
  private config: BybitProviderConfig;
  private baseUrl: string;
  private wsUrl: string;
  private category: string;
  private proxyAgent?: ProxyAgent;
  
  // WebSocket 连接
  private ws?: WebSocket;
  private klineCallbacks: Map<string, (bar: Kline) => void> = new Map();
  private tickCallbacks: Map<string, (tick: Tick) => void> = new Map();
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private isConnecting = false;
  private shuttingDown = false;
  
  constructor(config: BybitProviderConfig) {
    this.config = config;
    this.category = config.category || 'linear';
    
    if (config.testnet) {
      this.baseUrl = 'https://api-testnet.bybit.com';
      this.wsUrl = `wss://stream-testnet.bybit.com/v5/public/${this.category}`;
    } else {
      this.baseUrl = 'https://api.bybit.com';
      this.wsUrl = `wss://stream.bybit.com/v5/public/${this.category}`;
    }

    if (config.proxy) {
      this.proxyAgent = new ProxyAgent(config.proxy);
      console.log(`[BybitProvider] 使用代理: ${config.proxy}`);
    }
  }
  
  /**
   * 订阅 K线
   */
  async subscribeKlines(
    symbols: string[],
    interval: string,
    callback: (bar: Kline) => void
  ): Promise<void> {
    // 保存回调
    for (const symbol of symbols) {
      this.klineCallbacks.set(symbol, callback);
    }
    
    // 构建订阅主题
    const bybitInterval = this.toBybitInterval(interval);

    const topics = symbols.map(s => {
      const symbol = this.toExchangeSymbol(s);
      return `kline.${bybitInterval}.${symbol}`;
    });
    
    // 连接 WebSocket
    await this.connectWebSocket(topics);
  }
  
  /**
   * 订阅 Tick
   */
  async subscribeTicks?(symbols: string[], callback: (tick: Tick) => void): Promise<void> {
    for (const symbol of symbols) {
      this.tickCallbacks.set(symbol, callback);
    }
    
    const topics = symbols.map(s => {
      const symbol = this.toExchangeSymbol(s);
      return `tickers.${symbol}`;
    });
    
    await this.connectWebSocket(topics);
  }
  
  /**
   * 连接 WebSocket
   */
  private async connectWebSocket(topics: string[]): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    
    try {
      console.log(`[BybitProvider] 连接 WebSocket: ${this.wsUrl}`);
      
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.onopen = () => {
        console.log(`[BybitProvider] WebSocket 已连接`);
        this.isConnecting = false;
        
        // 订阅主题
        for (const topic of topics) {
          this.ws!.send(JSON.stringify({
            op: 'subscribe',
            args: [topic],
          }));
        }
        
        this.startHeartbeat();
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this.handleMessage(data);
        } catch (error) {
          console.error(`[BybitProvider] 解析消息失败:`, error);
        }
      };
      
      this.ws.onerror = (error) => {
        console.error(`[BybitProvider] WebSocket 错误:`, error);
        this.isConnecting = false;
      };
      
      this.ws.onclose = () => {
        if (this.shuttingDown) return;
        console.log(`[BybitProvider] WebSocket 已断开，5秒后重连...`);
        this.isConnecting = false;
        this.stopHeartbeat();
        this.scheduleReconnect(topics);
      };
    } catch (error) {
      console.error(`[BybitProvider] 连接失败:`, error);
      this.isConnecting = false;
      this.scheduleReconnect(topics);
    }
  }
  
  /**
   * 处理 WebSocket 消息
   */
  private handleMessage(data: any): void {
    // 响应 Ping
    if (data.op === 'ping') {
      this.ws?.send(JSON.stringify({ op: 'pong' }));
      return;
    }
    
    // K线消息
    if (data.topic && data.topic.startsWith('kline')) {
      const klineData = data as BybitKlineData;
      
      for (const k of klineData.data) {
        // 只处理完结的 K线
        if (!k.confirm) continue;
        
        // 从 topic 提取 symbol
        const parts = klineData.topic.split('.');
        const exchangeSymbol = parts[parts.length - 1];
        const symbol = this.fromExchangeSymbol(exchangeSymbol);
        
        const callback = this.klineCallbacks.get(symbol);
        if (callback) {
          const bar: Kline = {
            timestamp: Math.floor(k.start / 1000), // 毫秒 → 秒
            symbol,
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume),
            trades: 0, // Bybit 不提供
          };
          callback(bar);
        }
      }
    }
    
    // Ticker 消息
    else if (data.topic && data.topic.startsWith('tickers')) {
      const exchangeSymbol = data.topic.split('.')[1];
      const symbol = this.fromExchangeSymbol(exchangeSymbol);
      const callback = this.tickCallbacks.get(symbol);
      
      if (callback && data.data) {
        const tick: Tick = {
          timestamp: Math.floor(data.ts / 1000),
          symbol,
          price: parseFloat(data.data.lastPrice),
          volume: parseFloat(data.data.volume24h),
        };
        callback(tick);
      }
    }
  }
  
  /**
   * 心跳机制
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, 20000); // 20秒
  }
  
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
  
  /**
   * 重连机制
   */
  private scheduleReconnect(topics: string[]): void {
    if (this.shuttingDown) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.shuttingDown) return;
      this.connectWebSocket(topics);
    }, 5000);
  }
  
  /**
   * 买入
   */
  async buy(symbol: string, quantity: number, price?: number): Promise<Order> {
    const params: Record<string, any> = {
      category: this.category,
      symbol: this.toExchangeSymbol(symbol),
      side: 'Buy',
      orderType: price ? 'Limit' : 'Market',
      qty: quantity.toString(),
    };
    
    if (price) {
      params.price = price.toString();
    }
    
    const result = await this.request('POST', '/v5/order/create', params);
    return this.parseOrder(result.result);
  }
  
  /**
   * 卖出
   */
  async sell(symbol: string, quantity: number, price?: number): Promise<Order> {
    const params: Record<string, any> = {
      category: this.category,
      symbol: this.toExchangeSymbol(symbol),
      side: 'Sell',
      orderType: price ? 'Limit' : 'Market',
      qty: quantity.toString(),
    };
    
    if (price) {
      params.price = price.toString();
    }
    
    const result = await this.request('POST', '/v5/order/create', params);
    return this.parseOrder(result.result);
  }
  
  /**
   * 取消订单
   */
  async cancelOrder(orderId: string): Promise<void> {
    // orderId format: "symbol:id"
    const [symbolPart, id] = orderId.split(':');
    
    const params = {
      category: this.category,
      symbol: this.toExchangeSymbol(symbolPart),
      orderId: id,
    };
    
    await this.request('POST', '/v5/order/cancel', params);
  }
  
  /**
   * 获取账户信息
   */
  async getAccount(): Promise<Account> {
    // Bybit V5: /v5/account/wallet-balance only supports accountType=UNIFIED
    const params = {
      accountType: 'UNIFIED',
    };
    
    const result = await this.request('GET', '/v5/account/wallet-balance', params);
    
    let balance = 0;
    let equity = 0;

    if (result.result?.list?.[0]) {
      const account = result.result.list[0];
      equity = parseFloat(account.totalEquity) || 0;

      // pick USDT walletBalance as a rough available number
      const coin = account.coin?.find((c: any) => c.coin === 'USDT');
      if (coin) {
        balance = parseFloat(coin.walletBalance) || 0;
      }
    }

    return {
      balance,
      equity: equity || balance,
      availableMargin: balance,
    };
  }
  
  /**
   * 获取持仓
   */
  async getPosition(symbol: string): Promise<Position | null> {
    const params = {
      category: this.category,
      symbol: this.toExchangeSymbol(symbol),
    };
    
    const result = await this.request('GET', '/v5/position/list', params);
    
    if (result.result && result.result.list && result.result.list[0]) {
      return this.parsePosition(result.result.list[0]);
    }
    
    return null;
  }
  
  /**
   * 获取所有持仓
   */
  async getPositions(): Promise<Position[]> {
    const params = {
      category: this.category,
      settleCoin: 'USDT',
    };
    
    const result = await this.request('GET', '/v5/position/list', params);
    
    if (!result.result || !result.result.list) {
      return [];
    }
    
    return result.result.list
      .filter((p: any) => parseFloat(p.size) > 0)
      .map((p: any) => this.parsePosition(p));
  }
  
  /**
   * 发送 REST API 请求
   */
  private async request(
    method: string,
    endpoint: string,
    params: Record<string, any>
  ): Promise<any> {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    
    // 构建请求参数（Bybit 对签名要求 queryString/params 顺序一致，建议按 key 排序）
    let queryString = '';
    let body = '';

    if (method === 'GET') {
      queryString = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
    } else {
      // JSON body: keep stable order by sorting keys
      const sorted: Record<string, any> = {};
      for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
        if (v !== undefined) sorted[k] = v;
      }
      body = JSON.stringify(sorted);
    }
    
    // 生成签名
    const signString = timestamp + this.config.apiKey + recvWindow + (method === 'GET' ? queryString : body);
    const signature = this.generateSignature(signString);
    
    // 构建 URL
    const url = `${this.baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;
    
    const options: RequestInit = {
      method,
      headers: {
        'X-BAPI-API-KEY': this.config.apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'quant-lab/3.0',
      },
    };
    
    if (method !== 'GET') {
      options.body = body;
    }
    
    const response = await undiciFetch(url, {
      ...options,
      dispatcher: this.proxyAgent,
    } as any);

    const text = await response.text();

    // CloudFront region block page (HTML)
    const isCloudFrontBlock =
      response.status === 403 &&
      text.includes('The request could not be satisfied');

    if (isCloudFrontBlock) {
      // Fallback to curl with explicit --proxy (works more reliably in some environments)
      return this.requestViaCurl(method, url, body || undefined, options.headers as any);
    }

    let result: any;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      if (!response.ok) {
        throw new Error(`Bybit API HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
      throw new Error(`Bybit API 响应不是 JSON: ${text.slice(0, 300)}`);
    }

    if (!response.ok) {
      throw new Error(`Bybit API HTTP ${response.status}: ${result?.retMsg || response.statusText}`);
    }

    if (result?.retCode !== 0) {
      throw new Error(`Bybit API 错误: ${result?.retMsg}`);
    }

    return result;
  }
  
  /**
   * Fallback REST request via curl (better proxy compatibility)
   */
  private requestViaCurl(
    method: string,
    url: string,
    body: string | undefined,
    headers: Record<string, string>
  ): any {
    const args: string[] = [
      '-sS',
      '-X', method,
      url,
      '-m', '20',
    ];

    // Proxy
    const proxy = this.config.proxy;
    if (proxy) {
      args.push('-x', proxy);
    }

    // Headers
    for (const [k, v] of Object.entries(headers)) {
      args.push('-H', `${k}: ${v}`);
    }

    // Body
    if (body && method !== 'GET') {
      args.push('--data', body);
    }

    const out = execFileSync('curl', args, { encoding: 'utf8' });
    const text = (out || '').trim();

    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Bybit curl 响应不是 JSON: ${text.slice(0, 300)}`);
    }
  }

  /**
   * 生成签名（HMAC SHA256）
   */
  private generateSignature(message: string): string {
    const hmac = createHmac('sha256', this.config.apiSecret);
    hmac.update(message);
    return hmac.digest('hex');
  }
  
  /**
   * 解析订单响应
   */
  private parseOrder(data: any): Order {
    return {
      id: `${data.symbol}:${data.orderId}`,
      symbol: this.fromExchangeSymbol(data.symbol),
      side: data.side === 'Buy' ? 'BUY' : 'SELL',
      type: data.orderType === 'Market' ? 'MARKET' : 'LIMIT',
      quantity: parseFloat(data.qty),
      price: parseFloat(data.price) || 0,
      filled: parseFloat(data.cumExecQty) || 0,
      status: this.parseOrderStatus(data.orderStatus),
      timestamp: Math.floor(data.createdTime / 1000),
    };
  }
  
  /**
   * 解析订单状态
   */
  private parseOrderStatus(status: string): 'PENDING' | 'FILLED' | 'CANCELLED' {
    switch (status) {
      case 'New':
      case 'PartiallyFilled':
        return 'PENDING';
      case 'Filled':
        return 'FILLED';
      case 'Cancelled':
      case 'Rejected':
        return 'CANCELLED';
      default:
        return 'PENDING';
    }
  }
  
  /**
   * 解析持仓响应
   */
  private parsePosition(data: any): Position {
    return {
      symbol: this.fromExchangeSymbol(data.symbol),
      side: data.side === 'Buy' ? 'LONG' : 'SHORT',
      quantity: parseFloat(data.size),
      entryPrice: parseFloat(data.avgPrice),
      unrealizedPnl: parseFloat(data.unrealisedPnl),
      realizedPnl: 0,
    };
  }
  
  /**
   * 转换符号格式：BTC/USDT → BTCUSDT
   */
  private toExchangeSymbol(symbol: string): string {
    return symbol.replace('/', '').toUpperCase();
  }
  
  /**
   * 转换符号格式：BTCUSDT → BTC/USDT
   */
  private fromExchangeSymbol(symbol: string): string {
    if (symbol.endsWith('USDT')) {
      return `${symbol.slice(0, -4)}/USDT`;
    }
    return symbol;
  }
  
  /**
   * Bybit interval mapping
   *
   * Bybit v5 kline interval values:
   * - minutes: 1/3/5/15/30
   * - hours: 60/120/240/360/720
   * - day/week/month: D/W/M
   */
  private toBybitInterval(interval: string): string {
    const i = interval.trim();

    // already in Bybit format
    if (/^(1|3|5|15|30|60|120|240|360|720|D|W|M)$/.test(i)) return i;

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
      '1M': 'M',
      '1mo': 'M',
      '1month': 'M',
    };

    const mapped = map[i];
    if (!mapped) {
      throw new Error(`[BybitProvider] Unsupported interval: ${interval}`);
    }
    return mapped;
  }

  /**
   * 清理资源
   */
  async disconnect(): Promise<void> {
    this.shuttingDown = true;
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    
    this.klineCallbacks.clear();
    this.tickCallbacks.clear();
  }
}
