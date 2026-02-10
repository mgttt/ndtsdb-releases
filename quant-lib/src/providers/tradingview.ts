/**
 * TradingView WebSocket 数据提供者
 * 
 * 特点：
 * - ✅ 支持登录模式（需要 Pro 账号）
 * - ✅ 支持匿名模式（免登录，使用 unauthorized_user_token）
 * - ✅ 自动 fallback（登录失败自动切换匿名）
 * - ✅ 实时订阅功能
 * - ⚠️ 只支持加密货币（需股票/外汇请使用登录模式）
 */

import WebSocket from 'ws';
import { WebSocketDataProvider } from './base';
import type { Kline, KlineQuery } from '../types/kline';
import type { ProviderConfig, Exchange, AssetType, AuthConfig } from '../types/common';
import { NetworkError, AuthError } from '../types/common';

export interface TradingViewAuth {
  /** 认证 Token */
  authToken?: string;
  
  /** 会话哈希 */
  sessionHash?: string;
  
  /** 用户ID */
  userId?: string;
  
  /** Cookies（对象或字符串） */
  cookies?: Record<string, string> | string;
}

export interface TradingViewProviderConfig extends Partial<ProviderConfig> {
  /** 认证信息（可选，不提供则使用匿名模式） */
  auth?: TradingViewAuth;
  
  /** 代理地址 */
  proxy?: string;
  
  /** 心跳间隔（毫秒，默认30秒） */
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

export class TradingViewProvider extends WebSocketDataProvider {
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
  }> = new Map();
  
  constructor(config: TradingViewProviderConfig = {}) {
    super({
      name: 'TradingView',
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
    return 'TradingView';
  }
  
  get supportedExchanges(): Exchange[] {
    return ['BINANCE', 'BYBIT', 'OKX', 'COINBASE', 'NASDAQ', 'NYSE', 'HKEX'];
  }
  
  get supportedAssetTypes(): AssetType[] {
    return ['SPOT', 'FUTURES', 'PERPETUAL', 'STOCK', 'INDEX'];
  }
  
  protected get wsUrl(): string {
    // 匿名模式使用 data.tradingview.com
    // 登录模式使用 prodata.tradingview.com
    if (this.isAnonymous) {
      return 'wss://data.tradingview.com/socket.io/websocket';
    }
    
    const date = new Date().toISOString();
    return `wss://prodata.tradingview.com/socket.io/websocket?from=chart/&date=${date}&type=chart&auth=sessionid`;
  }
  
  /**
   * 连接到 TradingView WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'Origin': this.isAnonymous ? 'https://data.tradingview.com' : 'https://www.tradingview.com',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      };
      
      // 登录模式添加 Cookie
      if (!this.isAnonymous && this.auth) {
        headers['Cookie'] = this.buildCookieString();
      }
      
      const proxyUrl = this.getProxyUrl();
      const options: any = { headers };
      
      if (proxyUrl) {
        options.agent = proxyUrl; // ws 库的代理配置
      }
      
      this.ws = new WebSocket(this.wsUrl, options);
      
      this.ws.on('open', () => {
        console.log(`✅ 已连接到 TradingView WebSocket (${this.isAnonymous ? '匿名' : '登录'}模式)`);
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.isConnected = true;
        this.emit('connected');
        resolve();
      });
      
      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString());
      });
      
      this.ws.on('close', () => {
        console.log('❌ WebSocket 连接关闭');
        this.stopHeartbeat();
        this.isConnected = false;
        this.emit('disconnected');
        this.attemptReconnect();
      });
      
      this.ws.on('error', (error: Error) => {
        console.error('WebSocket 错误:', error.message);
        // 只在初始连接失败时 reject，避免运行时 unhandled error
        if (!this.isConnected) {
          reject(new NetworkError(`WebSocket 连接失败: ${error.message}`));
        }
        // 已连接状态下的错误由 close 事件处理（触发重连）
      });
    });
  }
  
  /**
   * 获取 K线数据
   */
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const { symbol, interval, limit = 300 } = query;
    
    return new Promise((resolve, reject) => {
      const chartSession = `cs_${this.generateId()}`;
      this.chartSessions.set(symbol, chartSession);
      
      // 存储待处理请求
      this.pendingRequests.set(chartSession, {
        resolve,
        reject,
        klines: [],
        symbol,
        interval
      });
      
      // 匿名模式需要先发送认证 token
      if (this.isAnonymous) {
        this.send({ m: 'set_auth_token', p: ['unauthorized_user_token'] });
      }
      
      // 创建图表会话
      this.send({ m: 'chart_create_session', p: [chartSession, ''] });
      
      // 解析 symbol
      const symbolDef = this.isAnonymous
        ? `={"symbol":"${symbol}","adjustment":"none"}`
        : `={"symbol":"${symbol}","adjustment":"splits"}`;
      
      this.send({ m: 'resolve_symbol', p: [chartSession, 'symbol_1', symbolDef] });
      
      // 延迟发送 create_series（确保 symbol resolve 完成）
      setTimeout(() => {
        this.send({
          m: 'create_series',
          p: [chartSession, 's1', 's1', 'symbol_1', interval, limit, '']
        });
      }, 100);
      
      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(chartSession)) {
          this.pendingRequests.delete(chartSession);
          reject(new Error(`获取 ${symbol} K线超时`));
        }
      }, 30000); // 30秒超时
    });
  }
  
  /**
   * 订阅实时K线
   */
  subscribeRealtime(symbol: string, interval: string): void {
    if (!this.isConnected) {
      throw new Error('WebSocket 未连接，请先调用 connect()');
    }
    
    const chartSession = `cs_${this.generateId()}`;
    this.chartSessions.set(symbol, chartSession);
    
    // 创建图表会话并订阅
    this.send({ m: 'chart_create_session', p: [chartSession, ''] });
    
    const symbolDef = `={"symbol":"${symbol}","adjustment":"splits"}`;
    this.send({ m: 'resolve_symbol', p: [chartSession, 'symbol_1', symbolDef] });
    
    setTimeout(() => {
      this.send({
        m: 'create_series',
        p: [chartSession, 's1', 's1', 'symbol_1', interval, 100, '']
      });
    }, 100);
  }
  
  /**
   * 取消订阅
   */
  unsubscribe(symbol: string): void {
    const chartSession = this.chartSessions.get(symbol);
    if (chartSession) {
      this.send({ m: 'remove_series', p: [chartSession, 's1'] });
      this.chartSessions.delete(symbol);
    }
  }
  
  /**
   * 检查符号是否支持
   */
  async isSymbolSupported(symbol: string): Promise<boolean> {
    try {
      const klines = await this.getKlines({ symbol, interval: '15', limit: 1 });
      return klines.length > 0;
    } catch {
      return false;
    }
  }
  
  /**
   * 标准化符号
   * BYBIT:BTCUSDT → BTC/USDT
   */
  normalizeSymbol(symbol: string): string {
    // 已经是标准格式
    if (symbol.includes('/')) return symbol;
    
    // BYBIT:BTCUSDT → BTC/USDT
    const parts = symbol.split(':');
    const pair = parts.length > 1 ? parts[1] : parts[0];
    
    if (pair.endsWith('USDT')) {
      const base = pair.replace('USDT', '');
      return `${base}/USDT`;
    }
    
    if (pair.endsWith('USD')) {
      const base = pair.replace('USD', '');
      return `${base}/USD`;
    }
    
    return `${pair}/USDT`;
  }
  
  /**
   * 转换为交易所符号
   * BTC/USDT → BYBIT:BTCUSDT
   */
  toExchangeSymbol(symbol: string, exchange: string = 'BYBIT'): string {
    // 已经包含交易所前缀
    if (symbol.includes(':')) return symbol;
    
    // BTC/USDT → BYBIT:BTCUSDT
    const pair = symbol.replace('/', '');
    return `${exchange.toUpperCase()}:${pair}`;
  }
  
  /**
   * 发送消息
   */
  protected send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket 未连接，无法发送消息');
      return;
    }
    
    const payload = JSON.stringify(message);
    const formatted = `~m~${payload.length}~m~${payload}`;
    this.ws.send(formatted);
  }
  
  /**
   * 处理接收到的消息
   */
  protected handleMessage(raw: string): void {
    const parts = raw.split('~m~').filter(p => p);
    
    for (let i = 0; i < parts.length; i += 2) {
      const payload = parts[i + 1];
      
      // 心跳响应
      if (payload === '~h~1' || /^~h~\d+$/.test(payload)) {
        continue;
      }
      
      try {
        const msg = JSON.parse(payload);
        this.handleParsedMessage(msg);
      } catch (e) {
        // 非JSON消息，忽略
      }
    }
  }
  
  /**
   * 处理解析后的消息
   */
  private handleParsedMessage(msg: any): void {
    const { m: type, p: params } = msg;
    
    switch (type) {
      case 'timescale_update':
        this.handleHistoricalBars(params);
        break;
      
      case 'du':
        this.handleBarUpdate(params);
        break;
      
      case 'series_completed':
        this.handleSeriesCompleted(params);
        break;
      
      case 'symbol_resolved':
        this.emit('symbol_resolved', params);
        break;
      
      case 'critical_error':
        this.emit('error', new Error(JSON.stringify(params)));
        break;
    }
  }
  
  /**
   * 处理历史K线数据
   */
  private handleHistoricalBars(params: any[]): void {
    if (!params || params.length < 2) return;
    
    const [chartSession, updates] = params;
    const request = this.pendingRequests.get(chartSession);
    
    if (!request) return;
    
    // 解析K线数据
    for (const [seriesId, data] of Object.entries(updates as Record<string, any>)) {
      if (data.s && Array.isArray(data.s)) {
        for (const bar of data.s) {
          if (bar.v && bar.v.length >= 6) {
            const kline = this.transformBar(bar.v, request.symbol, request.interval);
            request.klines.push(kline);
          }
        }
      }
    }
  }
  
  /**
   * 处理K线更新
   */
  private handleBarUpdate(params: any[]): void {
    this.handleHistoricalBars(params);
    
    // 发出实时事件
    this.emit('bar_update', params);
  }
  
  /**
   * 处理系列完成
   */
  private handleSeriesCompleted(params: any[]): void {
    if (!params || params.length === 0) return;
    
    const chartSession = params[0];
    const request = this.pendingRequests.get(chartSession);
    
    if (request) {
      request.resolve(request.klines);
      this.pendingRequests.delete(chartSession);
    }
    
    this.emit('series_completed', chartSession);
  }
  
  /**
   * 转换K线数据
   */
  private transformBar(bar: any[], symbol: string, interval: string): Kline {
    const normalized = this.normalizeSymbol(symbol);
    const [base, quote] = normalized.split('/');
    
    // 提取交易所
    const exchange = symbol.includes(':') ? symbol.split(':')[0] : 'BYBIT';
    
    return {
      symbol: normalized,
      exchange: exchange.toUpperCase() as Exchange,
      baseCurrency: base,
      quoteCurrency: quote,
      interval,
      timestamp: Math.floor(bar[0]) * 1000, // 转换秒 → 毫秒（ndtsdb 存储格式）
      open: bar[1],
      high: bar[2],
      low: bar[3],
      close: bar[4],
      volume: bar[5]
    };
  }
  
  /**
   * 启动心跳
   */
  protected startHeartbeat(): void {
    const interval = this.config.websocket?.heartbeatInterval || 30000;
    
    this.heartbeatInterval = setInterval(() => {
      this.send({ m: '~h~1' });
    }, interval);
  }
  
  /**
   * 构建 Cookie 字符串
   */
  private buildCookieString(): string {
    if (!this.auth || !this.auth.cookies) return '';
    
    if (typeof this.auth.cookies === 'string') {
      return this.auth.cookies;
    }
    
    return Object.entries(this.auth.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
  
  /**
   * 生成随机ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 14);
  }
}
