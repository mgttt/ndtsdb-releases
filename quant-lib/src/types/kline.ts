/**
 * K线数据类型定义
 */

/**
 * 统一的K线数据格式
 * 所有数据提供者返回的数据都转换为这个格式
 */
export interface Kline {
  /** 标准化符号（如 BTC/USDT） */
  symbol: string;
  
  /** 交易所（BINANCE/BYBIT/NASDAQ等） */
  exchange: string;
  
  /** 基础货币（BTC/ETH/AAPL等） */
  baseCurrency: string;
  
  /** 计价货币（USDT/USD等） */
  quoteCurrency: string;
  
  /** 时间周期（15m/1h/1d等） */
  interval: string;
  
  /** Unix 秒时间戳 */
  timestamp: number;
  
  /** 开盘价 */
  open: number;
  
  /** 最高价 */
  high: number;
  
  /** 最低价 */
  low: number;
  
  /** 收盘价 */
  close: number;
  
  /** 成交量（基础货币） */
  volume: number;
  
  /** 成交额（计价货币，可选） */
  quoteVolume?: number;
  
  /** 成交笔数（可选） */
  trades?: number;
  
  /** 主动买入成交量（可选） */
  takerBuyVolume?: number;
  
  /** 主动买入成交额（可选） */
  takerBuyQuoteVolume?: number;
}

/**
 * K线查询参数
 */
export interface KlineQuery {
  /** 标准化符号（如 BTC/USDT） */
  symbol: string;
  
  /** 时间周期（1m/3m/5m/15m/30m/1h/2h/4h/6h/8h/12h/1d/3d/1w/1M） */
  interval: string;
  
  /** 返回数量（最多1000） */
  limit?: number;
  
  /** 开始时间（Unix 秒，可选） */
  startTime?: number;
  
  /** 结束时间（Unix 秒，可选） */
  endTime?: number;
}

/**
 * 时间周期类型
 */
export type Interval = 
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M';

/**
 * 时间周期配置
 */
export interface IntervalConfig {
  /** 周期名称 */
  interval: Interval;
  
  /** 毫秒数 */
  milliseconds: number;
  
  /** 秒数 */
  seconds: number;
  
  /** 分钟数 */
  minutes: number;
  
  /** 小时数（可能是小数） */
  hours: number;
  
  /** 天数（可能是小数） */
  days: number;
}

/**
 * 时间周期映射表
 */
export const INTERVAL_MAP: Record<Interval, IntervalConfig> = {
  '1m': { interval: '1m', milliseconds: 60000, seconds: 60, minutes: 1, hours: 1/60, days: 1/1440 },
  '3m': { interval: '3m', milliseconds: 180000, seconds: 180, minutes: 3, hours: 1/20, days: 1/480 },
  '5m': { interval: '5m', milliseconds: 300000, seconds: 300, minutes: 5, hours: 1/12, days: 1/288 },
  '15m': { interval: '15m', milliseconds: 900000, seconds: 900, minutes: 15, hours: 0.25, days: 1/96 },
  '30m': { interval: '30m', milliseconds: 1800000, seconds: 1800, minutes: 30, hours: 0.5, days: 1/48 },
  '1h': { interval: '1h', milliseconds: 3600000, seconds: 3600, minutes: 60, hours: 1, days: 1/24 },
  '2h': { interval: '2h', milliseconds: 7200000, seconds: 7200, minutes: 120, hours: 2, days: 1/12 },
  '4h': { interval: '4h', milliseconds: 14400000, seconds: 14400, minutes: 240, hours: 4, days: 1/6 },
  '6h': { interval: '6h', milliseconds: 21600000, seconds: 21600, minutes: 360, hours: 6, days: 0.25 },
  '8h': { interval: '8h', milliseconds: 28800000, seconds: 28800, minutes: 480, hours: 8, days: 1/3 },
  '12h': { interval: '12h', milliseconds: 43200000, seconds: 43200, minutes: 720, hours: 12, days: 0.5 },
  '1d': { interval: '1d', milliseconds: 86400000, seconds: 86400, minutes: 1440, hours: 24, days: 1 },
  '3d': { interval: '3d', milliseconds: 259200000, seconds: 259200, minutes: 4320, hours: 72, days: 3 },
  '1w': { interval: '1w', milliseconds: 604800000, seconds: 604800, minutes: 10080, hours: 168, days: 7 },
  '1M': { interval: '1M', milliseconds: 2592000000, seconds: 2592000, minutes: 43200, hours: 720, days: 30 },
};

/**
 * 获取时间周期配置
 */
export function getIntervalConfig(interval: string): IntervalConfig {
  const config = INTERVAL_MAP[interval as Interval];
  if (!config) {
    throw new Error(`不支持的时间周期: ${interval}`);
  }
  return config;
}

/**
 * 计算时间范围内的K线数量
 */
export function calculateBarsCount(
  startTime: number,
  endTime: number,
  interval: string
): number {
  const config = getIntervalConfig(interval);
  const diffMs = endTime - startTime;
  return Math.ceil(diffMs / config.milliseconds);
}

/**
 * 计算天数对应的K线数量
 */
export function daysToBarsCont(days: number, interval: string): number {
  const config = getIntervalConfig(interval);
  return Math.ceil(days / config.days);
}

/**
 * 计算K线数量对应的天数
 */
export function barsToDays(bars: number, interval: string): number {
  const config = getIntervalConfig(interval);
  return bars * config.days;
}
