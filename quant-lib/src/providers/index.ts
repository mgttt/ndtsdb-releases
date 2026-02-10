/**
 * 数据提供者统一导出
 */

export { DataProvider, RestDataProvider, WebSocketDataProvider } from './base.js';
export { BinanceProvider } from './binance.js';
export { BinanceCurlProvider } from './binance-curl.js';
export { BybitProvider } from './bybit.js';
export { TradingViewProvider } from './tradingview.js';

// NOTE: FUTU provider depends on a futu-trader native client that is not present in this repo.
// Import it directly only in environments that have that dependency.
// export { FutuProvider } from './futu.js';

export { 
  PaperTradingProvider,
  type PaperTradingConfig,
  type PaperOrder,
  type PaperPosition,
  type PaperTrade,
  type PaperAccountState,
  type PlaceOrderParams,
  type PlaceOrderResult,
  type EquityPoint,
  type PaperStats
} from './paper-trading.js';
