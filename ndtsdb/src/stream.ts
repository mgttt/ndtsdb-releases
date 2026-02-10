// ============================================================
// 流式聚合 - 增量窗口计算
// ============================================================

/**
 * 滑动窗口聚合器（基类）
 */
export abstract class SlidingWindowAggregator {
  protected window: number[] = [];
  protected windowSize: number;

  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  /**
   * 添加新值并返回聚合结果
   */
  add(value: number): number {
    this.window.push(value);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
    return this.compute();
  }

  /**
   * 重置窗口
   */
  reset(): void {
    this.window = [];
  }

  /**
   * 获取当前窗口大小
   */
  getWindowLength(): number {
    return this.window.length;
  }

  /**
   * 计算聚合值（子类实现）
   */
  protected abstract compute(): number;
}

/**
 * 滑动平均（SMA）
 */
export class StreamingSMA extends SlidingWindowAggregator {
  protected compute(): number {
    if (this.window.length === 0) return 0;
    const sum = this.window.reduce((a, b) => a + b, 0);
    return sum / this.window.length;
  }
}

/**
 * 指数移动平均（EMA）
 */
export class StreamingEMA {
  private alpha: number;
  private ema: number | null = null;

  constructor(period: number) {
    this.alpha = 2 / (period + 1);
  }

  add(value: number): number {
    if (this.ema === null) {
      this.ema = value;
    } else {
      this.ema = this.alpha * value + (1 - this.alpha) * this.ema;
    }
    return this.ema;
  }

  reset(): void {
    this.ema = null;
  }

  getValue(): number | null {
    return this.ema;
  }
}

/**
 * 滑动标准差
 */
export class StreamingStdDev extends SlidingWindowAggregator {
  protected compute(): number {
    if (this.window.length < 2) return 0;

    const mean = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    const variance = this.window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / this.window.length;
    return Math.sqrt(variance);
  }
}

/**
 * 滑动最小值
 */
export class StreamingMin extends SlidingWindowAggregator {
  protected compute(): number {
    if (this.window.length === 0) return 0;
    return Math.min(...this.window);
  }
}

/**
 * 滑动最大值
 */
export class StreamingMax extends SlidingWindowAggregator {
  protected compute(): number {
    if (this.window.length === 0) return 0;
    return Math.max(...this.window);
  }
}

/**
 * 多指标流式计算器（组合多个聚合器）
 */
export class StreamingAggregator {
  private aggregators: Map<string, SlidingWindowAggregator | StreamingEMA> = new Map();

  /**
   * 添加聚合器
   */
  addAggregator(name: string, aggregator: SlidingWindowAggregator | StreamingEMA): void {
    this.aggregators.set(name, aggregator);
  }

  /**
   * 添加新值并返回所有聚合结果
   */
  add(value: number): Record<string, number> {
    const results: Record<string, number> = {};
    for (const [name, agg] of this.aggregators) {
      results[name] = agg.add(value);
    }
    return results;
  }

  /**
   * 重置所有聚合器
   */
  reset(): void {
    for (const agg of this.aggregators.values()) {
      agg.reset();
    }
  }
}
