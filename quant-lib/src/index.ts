/**
 * Quant-Lib - 统一量化数据工具库
 */

// Exchange Clients (Unified)
export { BybitClient, BinanceClient } from './exchange/index';
export type { BybitConfig, BinanceConfig } from './exchange/index';

// Database
export { KlineDatabase } from './storage/database.js';

// Indicators (Real-time)
export { StreamingIndicators } from './indicators/streaming-indicators';
export type { IndicatorConfig, IndicatorResult } from './indicators/streaming-indicators';

// Providers
export { 
  BinanceProvider,
  TradingViewProvider,
  BybitProvider,
  PaperTradingProvider
} from './providers/index.js';
export type { 
  BybitProviderConfig, 
  AccountOverview, 
  Position, 
  CoinBalance,
  PaperTradingConfig,
  PaperOrder,
  PaperPosition,
  PaperTrade,
  PaperAccountState,
  PlaceOrderParams,
  PlaceOrderResult,
  EquityPoint,
  PaperStats
} from './providers/index.js';

// NOTE: FUTU provider depends on a futu-trader native client that is not present in this repo.
// Import it directly only in environments that have that dependency.
//   import { FutuProvider } from './providers/futu.js'

// Strategy API (for quant-lab)
export type * from './strategy-api/index.js';

// Analytics (Real-time persistence)
export { TradeAnalytics } from './analytics/index.js';
export type { TradeRecord, EquitySnapshot } from './analytics/index.js';

// Cache & Optimization
export { SmartKlineCache } from './cache/SmartKlineCache.js';

// Scheduler
export { PriorityCollector, StockPriority } from './scheduler/PriorityCollector.js';
export { TimerScheduler } from './scheduler/TimerScheduler.js';
export type { TimerConfig, TimerStatus } from './scheduler/TimerScheduler.js';

// Strategy Pool & Timer Integration
export { StrategyTimerIntegration } from './strategy/StrategyTimerIntegration.js';

// Router
export { DataSourceRouter, AssetCategory } from './router/DataSourceRouter.js';

// Utils
export { Logger, createLogger, ConfigManager, configManager, loadAccounts, getAccount } from './utils/index';
export type { LoggerConfig, AccountEntry } from './utils/index';

// Types
export type * from './types/kline.js';
export type * from './types/common.js';
export type * from './types/index';
