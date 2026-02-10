/**
 * 策略 API 类型定义
 * 
 * 为 quant-lab 策略引擎提供的统一接口类型
 */

import type { PaperOrder, PaperPosition, PaperTrade } from '../providers/paper-trading.js';

/**
 * 行情数据
 */
export interface Ticker {
  symbol: string;
  lastPrice: string;
  bid1Price: string;
  ask1Price: string;
  highPrice24h: string;
  lowPrice24h: string;
  volume24h: string;
  turnover24h: string;
  timestamp: number;
}

/**
 * K 线数据
 */
export interface Kline {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 下单参数
 */
export interface OrderParams {
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit';
  qty: number;
  price?: number;
}

/**
 * 订单结果
 */
export interface OrderResult {
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  qty: number;
  price: number;
  status: string;
  createdAt: number;
}

/**
 * 持仓数据
 */
export interface Position {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  avgPrice: number;
  markPrice: number;
  leverage: number;
  unrealisedPnl: number;
  positionValue: number;
}

/**
 * 余额数据
 */
export interface Balance {
  coin: string;
  walletBalance: number;
  availableToWithdraw: number;
  usdValue: number;
  unrealisedPnl: number;
}

/**
 * 日志接口
 */
export interface StrategyLogger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

/**
 * 交易所 API 接口（策略可使用的方法）
 */
export interface ExchangeAPI {
  /** 获取最新价格 */
  getPrice(symbol: string): Promise<number>;
  
  /** 获取完整行情 */
  getTicker(symbol: string): Promise<Ticker>;
  
  /** 获取 K 线数据 */
  getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]>;
  
  /** 下单 */
  placeOrder(params: OrderParams): Promise<OrderResult>;
  
  /** 撤单 */
  cancelOrder(orderId: string): Promise<boolean>;
  
  /** 获取订单 */
  getOrder(orderId: string): Promise<OrderResult | null>;
  
  /** 获取活跃订单 */
  getActiveOrders(symbol?: string): Promise<OrderResult[]>;
  
  /** 获取持仓 */
  getPosition(symbol: string): Promise<Position | null>;
  
  /** 获取所有持仓 */
  getPositions(): Promise<Position[]>;
  
  /** 获取余额 */
  getBalance(coin?: string): Promise<Balance | Record<string, Balance>>;
}

/**
 * 策略运行时上下文
 */
export interface StrategyContext {
  /** API 客户端（Bybit 或 Paper Trading） */
  bybit: ExchangeAPI;
  
  /** 日志器 */
  logger: StrategyLogger;
  
  /** 策略参数 */
  params: Record<string, any>;
  
  /** 策略状态（持久化） */
  state: Record<string, any>;
  
  /** 元数据 */
  meta: {
    strategyId: string;
    account: string;
    runCount: number;
    lastRunAt: number;
    isPaperTrading: boolean;
  };
}

/**
 * 策略执行结果
 */
export interface StrategyResult {
  success: boolean;
  actions?: number;
  message?: string;
  data?: Record<string, any>;
  error?: string;
  duration?: number;
}

/**
 * 策略函数类型
 */
export type StrategyFunction = (ctx: StrategyContext) => Promise<StrategyResult>;
