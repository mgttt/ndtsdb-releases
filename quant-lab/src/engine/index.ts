// ============================================================
// 策略引擎统一导出
// ============================================================

export { BacktestEngine } from './backtest';
export { LiveEngine } from './live';
export type { TradingProvider } from './live';

export type {
  Strategy,
  StrategyContext,
  BacktestConfig,
  BacktestResult,
  LiveConfig,
  Order,
  Position,
  Account,
  Tick,
  OrderSide,
  OrderType,
  OrderStatus,
  PositionSide,
} from './types';
