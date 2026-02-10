// ============================================================
// 指标模块统一导出
// ============================================================

// 流式指标（实时计算，用于 WebSocket）
export {
  StreamingIndicators,
  type IndicatorConfig,
  type IndicatorResult,
} from './streaming-indicators';

// 批量指标（回测计算，用于历史数据分析）
export {
  sma,
  ema,
  wma,
  macd,
  rsi,
  bollingerBands,
  atr,
  obv,
  stdDev,
  momentum,
  roc,
} from './indicators';
