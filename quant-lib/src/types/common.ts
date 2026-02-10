/**
 * 通用类型定义
 */

/**
 * 代理配置
 */
export interface ProxyConfig {
  /** 代理地址（如 http://127.0.0.1:8890） */
  url?: string;
  
  /** 用户名（可选） */
  username?: string;
  
  /** 密码（可选） */
  password?: string;
}

/**
 * HTTP 请求配置
 */
export interface HttpConfig {
  /** 代理配置 */
  proxy?: ProxyConfig | string;
  
  /** 超时时间（毫秒） */
  timeout?: number;
  
  /** 重试次数 */
  retries?: number;
  
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  
  /** 请求头 */
  headers?: Record<string, string>;
}

/**
 * WebSocket 配置
 */
export interface WebSocketConfig {
  /** 代理配置 */
  proxy?: ProxyConfig | string;
  
  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number;
  
  /** 重连间隔（毫秒） */
  reconnectInterval?: number;
  
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
  
  /** 请求头 */
  headers?: Record<string, string>;
}

/**
 * 认证配置
 */
export interface AuthConfig {
  /** API Key（用于 REST API） */
  apiKey?: string;
  
  /** API Secret（用于 REST API） */
  apiSecret?: string;
  
  /** Cookie（用于浏览器API） */
  cookies?: Record<string, string> | string;
  
  /** Bearer Token */
  token?: string;
  
  /** 会话ID */
  sessionId?: string;
  
  /** 用户ID */
  userId?: string;
  
  /** 自定义字段 */
  [key: string]: any;
}

/**
 * 数据提供者配置
 */
export interface ProviderConfig {
  /** 名称 */
  name: string;
  
  /** HTTP 配置 */
  http?: HttpConfig;
  
  /** WebSocket 配置 */
  websocket?: WebSocketConfig;
  
  /** 认证配置 */
  auth?: AuthConfig;
  
  /** 代理（简化配置） */
  proxy?: ProxyConfig | string;
}

/**
 * 数据库配置
 */
export interface DatabaseConfig {
  /** 数据库路径 */
  path: string;
  
  /** 访问模式 */
  accessMode?: 'READ_ONLY' | 'READ_WRITE';
  
  /** 是否自动初始化 schema */
  autoInit?: boolean;
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** TTL（秒） */
  ttl?: number;
  
  /** 最大条目数 */
  maxEntries?: number;
  
  /** Redis 连接（可选） */
  redis?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
}

/**
 * 交易所类型
 */
export type Exchange = 
  | 'BINANCE'
  | 'BYBIT'
  | 'OKX'
  | 'HUOBI'
  | 'COINBASE'
  | 'KRAKEN'
  | 'NASDAQ'
  | 'NYSE'
  | 'HKEX'
  | 'SSE'  // 上交所
  | 'SZSE' // 深交所
  | 'OTHER';

/**
 * 资产类型
 */
export type AssetType = 
  | 'SPOT'        // 现货
  | 'FUTURES'     // 期货
  | 'PERPETUAL'   // 永续合约
  | 'OPTION'      // 期权
  | 'STOCK'       // 股票
  | 'FOREX'       // 外汇
  | 'INDEX';      // 指数

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 错误类型
 */
export class QuotaError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}

/**
 * 速率限制错误
 */
export class RateLimitError extends QuotaError {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

/**
 * 认证错误
 */
export class AuthError extends QuotaError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthError';
  }
}

/**
 * 网络错误
 */
export class NetworkError extends QuotaError {
  constructor(message: string, details?: any) {
    super(message, 'NETWORK_ERROR', undefined, details);
    this.name = 'NetworkError';
  }
}
