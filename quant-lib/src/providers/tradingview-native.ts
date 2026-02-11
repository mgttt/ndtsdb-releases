/**
 * TradingView WebSocket 数据提供者（Bun原生版本）
 * 
 * 关键改进：
 * - ✅ 使用Bun原生WebSocket（不用ws库）
 * - ✅ 避免Bun的ws兼容层bug
 * - ✅ 代理支持通过环境变量
 */

import { WebSocketDataProvider } from './base';
import type { Kline, KlineQuery } from '../types/kline';
import type { ProviderConfig, Exchange, AssetType } from '../types/common';
import { NetworkError } from '../types/common';

export interface TradingViewAuth {
  authToken?: string;
  sessionHash?: string;
  userId?: string;
  cookies?: Record<string, string> | string;
}

export interface TradingViewNativeConfig extends Partial<ProviderConfig> {
  auth?: TradingViewAuth;
  proxy?: string;
  heartbeatInterval?: number;
}

interface BarData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class TradingViewNativeProvider extends WebSocketDataProvider {
  private auth: TradingViewAuth | null;
  private isAnonymous: boolean;
  private sessionId: string;
  private chartSessions: Map<string, string> = new Map();
  private pendingRequests: Map<string, {
    resolve: (klines: Kline[]) => void;
    reject: (error: Error) => void;
    klines: Kline[];
    symbol: string;
    interval: string;
    timeoutHandle?: NodeJS.Timeout;
  }> = new Map();
  
  private requestCount = 0;
  private readonly REQUEST_LIMIT = 4;
  private isRebuilding = false;
  private connectPromise: Promise<void> | null = null;
  
  constructor(config: TradingViewNativeConfig = {}) {
    super({
      name: 'TradingView-Native',
      websocket: {
        heartbeatInterval: config.heartbeatInterval || 30000
      },
      ...config
    });
    
    this.auth = config.auth || null;
    this.isAnonymous = !config.auth;
    this.sessionId = `qs_${this.generateId()}`;
  }
  
  get name(): string {
    return 'TradingView-Native';
  }
  
  get supportedExchanges(): Exchange[] {
    return ['BINANCE', 'BYBIT', 'OKX', 'COINBASE', 'NASDAQ', 'NYSE', 'HKEX'];
  }
  
  get supportedAssetTypes(): AssetType[] {
    return ['SPOT', 'FUTURES', 'PERPETUAL', 'STOCK', 'INDEX'];
  }
  
  protected get wsUrl(): string {
    if (this.isAnonymous) {
      return 'wss://data.tradingview.com/socket.io/websocket';
    }
    return 'wss://prodata.tradingview.com/socket.io/websocket';
  }
  
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // ⚡ Bun原生WebSocket（不用ws库）
      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (error: any) {
        reject(new NetworkError(`WebSocket创建失败: ${error.message}`));
        return;
      }
      
      this.ws.onopen = () => {
        console.log(`✅ 已连接到 TradingView WebSocket (${this.isAnonymous ? '匿名' : '登录'}模式 - Bun原生)`);
        this.reconnectAttempts = 0;
        this.shouldReconnect = true;
        this.startHeartbeat();
        this.isConnected = true;
        this.emit('connected');
        resolve();
      };
      
      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };
      
      this.ws.onclose = () => {
        console.log('❌ WebSocket 连接关闭');
        this.stopHeartbeat();
        this.isConnected = false;
        this.emit('disconnected');
        this.rejectAllPending(new Error('WebSocket 连接关闭'));
      };
      
      this.ws.onerror = (event: Event) => {
        console.error('WebSocket 错误:', event);
        if (!this.isConnected) {
          reject(new NetworkError(`WebSocket 连接失败`));
        }
      };
    });
  }
  
  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    
    if (this.ws) {
      // Bun原生WebSocket没有removeAllListeners
      // 直接设置为null即可，事件处理器会被GC回收
      this.ws.close();
      this.ws = null;
    }
    
    await super.disconnect();
  }
  
  protected send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }
    
    const payload = `~m~${JSON.stringify(message).length}~m~${JSON.stringify(message)}`;
    this.ws.send(payload);
  }
  
  protected handleMessage(raw: string): void {
    const messages = this.parseMessages(raw);
    
    for (const msg of messages) {
      if (!msg.m) continue;
      
      switch (msg.m) {
        case 'timescale_update':
          this.handleHistoricalBars(msg.p);
          break;
        case 'du':
          this.handleBarUpdate(msg.p);
          break;
        case 'series_completed':
          this.handleSeriesCompleted(msg.p);
          break;
      }
    }
  }
  
  private parseMessages(raw: string): any[] {
    const messages: any[] = [];
    let pos = 0;
    
    while (pos < raw.length) {
      if (!raw.startsWith('~m~', pos)) break;
      
      pos += 3;
      const lengthEnd = raw.indexOf('~m~', pos);
      if (lengthEnd === -1) break;
      
      const length = parseInt(raw.substring(pos, lengthEnd));
      pos = lengthEnd + 3;
      
      const payload = raw.substring(pos, pos + length);
      pos += length;
      
      try {
        messages.push(JSON.parse(payload));
      } catch {
        continue;
      }
    }
    
    return messages;
  }
  
  private handleHistoricalBars(params: any[]): void {
    if (!params || params.length < 2) return;
    
    const chartSession = params[0];
    const request = this.pendingRequests.get(chartSession);
    
    if (request && params[1]?.sds_1?.s) {
      for (const bar of params[1].sds_1.s) {
        if (bar.v && bar.v.length >= 6) {
          const kline = this.transformBar(bar.v, request.symbol, request.interval);
          request.klines.push(kline);
        }
      }
    }
  }
  
  private handleBarUpdate(params: any[]): void {
    this.handleHistoricalBars(params);
    this.emit('bar_update', params);
  }
  
  private handleSeriesCompleted(params: any[]): void {
    if (!params || params.length === 0) return;
    
    const chartSession = params[0];
    const request = this.pendingRequests.get(chartSession);
    
    if (request) {
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
      request.resolve(request.klines);
      this.pendingRequests.delete(chartSession);
    }
    
    this.emit('series_completed', chartSession);
  }
  
  private transformBar(bar: any[], symbol: string, interval: string): Kline {
    const normalized = this.normalizeSymbol(symbol);
    const [base, quote] = normalized.split('/');
    const exchange = symbol.includes(':') ? symbol.split(':')[0] : 'BYBIT';
    
    return {
      symbol: normalized,
      exchange: exchange.toUpperCase() as Exchange,
      baseCurrency: base,
      quoteCurrency: quote,
      interval,
      timestamp: Math.floor(bar[0]) * 1000,
      open: bar[1],
      high: bar[2],
      low: bar[3],
      close: bar[4],
      volume: bar[5]
    };
  }
  
  protected startHeartbeat(): void {
    const interval = this.config.websocket?.heartbeatInterval || 30000;
    
    this.heartbeatInterval = setInterval(() => {
      this.send({ m: '~h~1' });
    }, interval);
  }
  
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    if (this.requestCount > 0 && this.requestCount % this.REQUEST_LIMIT === 0 && !this.isRebuilding) {
      await this.rebuildConnection();
    } else if (!this.isConnected) {
      await this.ensureConnected();
    }
    
    this.requestCount++;
    
    const { symbol, interval, limit = 300 } = query;
    
    return new Promise((resolve, reject) => {
      const chartSession = `cs_${this.generateId()}`;
      this.chartSessions.set(symbol, chartSession);
      
      const fail = (e: Error) => {
        const req = this.pendingRequests.get(chartSession);
        if (req?.timeoutHandle) {
          clearTimeout(req.timeoutHandle);
        }
        this.pendingRequests.delete(chartSession);
        this.chartSessions.delete(symbol);
        reject(e);
      };
      
      const timeoutHandle = setTimeout(() => {
        if (this.pendingRequests.has(chartSession)) {
          fail(new Error(`获取 ${symbol} K线超时（3秒无响应）`));
        }
      }, 3000);
      
      this.pendingRequests.set(chartSession, {
        resolve,
        reject,
        klines: [],
        symbol,
        interval,
        timeoutHandle
      });
      
      if (this.isAnonymous) {
        this.sendOrReject(chartSession, { m: 'set_auth_token', p: ['unauthorized_user_token'] }, fail);
      }
      
      this.sendOrReject(chartSession, { m: 'chart_create_session', p: [chartSession, ''] }, fail);
      
      const symbolDef = this.isAnonymous
        ? `={"symbol":"${symbol}","adjustment":"none"}`
        : `={"symbol":"${symbol}","adjustment":"splits"}`;
      
      this.sendOrReject(chartSession, { m: 'resolve_symbol', p: [chartSession, 'symbol_1', symbolDef] }, fail);
      
      setTimeout(() => {
        if (!this.pendingRequests.has(chartSession)) return;
        
        this.sendOrReject(chartSession, {
          m: 'create_series',
          p: [chartSession, 's1', 's1', 'symbol_1', interval, limit, '']
        }, fail);
      }, 100);
    });
  }
  
  private async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    
    if (!this.isConnected) {
      this.connectPromise = this.connect().finally(() => {
        this.connectPromise = null;
      });
      await this.connectPromise;
    }
  }
  
  private async rebuildConnection(): Promise<void> {
    if (this.isRebuilding) {
      console.log('⏳ 等待当前重建完成...');
      while (this.isRebuilding) {
        await this.delay(100);
      }
      return;
    }
    
    this.isRebuilding = true;
    
    try {
      console.log(`🔄 主动重建连接（已完成 ${this.requestCount} 个请求）`);
      
      this.shouldReconnect = false;
      await this.disconnect();
      await this.delay(1000);
      
      this.shouldReconnect = true;
      await this.connect();
      
      this.requestCount = 0;
    } finally {
      this.isRebuilding = false;
    }
  }
  
  private rejectAllPending(error: Error): void {
    for (const [chartSession, request] of this.pendingRequests) {
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
      try {
        request.reject(error);
      } catch {}
    }
    this.pendingRequests.clear();
    this.chartSessions.clear();
  }
  
  private sendOrReject(chartSession: string, message: any, reject: (e: Error) => void): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket 未连接'));
      return false;
    }
    this.send(message);
    return true;
  }
  
  async isSymbolSupported(symbol: string): Promise<boolean> {
    return true;
  }
  
  normalizeSymbol(symbol: string): string {
    if (symbol.includes('/')) return symbol;
    if (symbol.includes(':')) {
      const parts = symbol.split(':');
      return this.normalizeSymbol(parts[1]);
    }
    
    const quote = symbol.endsWith('USDT') ? 'USDT' : 'USD';
    const base = symbol.replace(quote, '');
    return `${base}/${quote}`;
  }
  
  toExchangeSymbol(symbol: string): string {
    return symbol.replace('/', '');
  }
  
  private generateId(): string {
    return Math.random().toString(36).substring(2, 14);
  }
}
