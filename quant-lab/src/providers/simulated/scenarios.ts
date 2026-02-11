/**
 * SimulatedProvider 场景 DSL
 * 
 * 用于定义价格走势场景，支持快速策略验证
 */

export interface ScenarioPhase {
  type: 'range' | 'trend' | 'dump' | 'pump' | 'gap';
  durationSec: number;
  
  // range 模式
  price?: number;      // 中心价
  range?: number;      // 振幅（百分比，如 0.02 = 2%）
  
  // trend/dump/pump 模式
  change?: number;     // 变化幅度（百分比）
  targetPrice?: number; // 目标价
}

export interface Scenario {
  name: string;
  description: string;
  startPrice: number;
  phases: ScenarioPhase[];
}

/**
 * 内置场景库
 */
export const SCENARIOS: Record<string, Scenario> = {
  // 区间震荡后下跌（测试 autoRecenter）
  'range-then-dump': {
    name: 'Range Then Dump',
    description: '区间震荡 5 分钟，然后下跌 10%，测试 autoRecenter',
    startPrice: 100,
    phases: [
      {
        type: 'range',
        durationSec: 300,
        price: 100,
        range: 0.02, // ±2%
      },
      {
        type: 'dump',
        durationSec: 60,
        change: -0.10, // -10%
      },
      {
        type: 'range',
        durationSec: 300,
        price: 90,
        range: 0.02,
      },
    ],
  },

  // 正弦波动（测试网格来回成交）
  'sine-wave': {
    name: 'Sine Wave',
    description: '正弦波动 10 分钟，振幅 5%，测试网格成交',
    startPrice: 100,
    phases: [
      {
        type: 'range',
        durationSec: 600,
        price: 100,
        range: 0.05, // ±5%
      },
    ],
  },

  // 缓慢趋势（测试持仓暴露）
  'slow-drift': {
    name: 'Slow Drift',
    description: '缓慢上涨 10 分钟 +5%，测试持仓暴露',
    startPrice: 100,
    phases: [
      {
        type: 'trend',
        durationSec: 600,
        change: 0.05, // +5%
      },
    ],
  },

  // 先涨后跌（测试双向网格）
  'pump-then-dump': {
    name: 'Pump Then Dump',
    description: '先涨 5% 再跌 8%',
    startPrice: 100,
    phases: [
      {
        type: 'pump',
        durationSec: 120,
        change: 0.05, // +5%
      },
      {
        type: 'dump',
        durationSec: 120,
        change: -0.08, // -8%
      },
      {
        type: 'range',
        durationSec: 180,
        price: 97,
        range: 0.02,
      },
    ],
  },

  // 跳空缺口（测试异常处理）
  'gap-down': {
    name: 'Gap Down',
    description: '震荡后跳空下跌 15%',
    startPrice: 100,
    phases: [
      {
        type: 'range',
        durationSec: 180,
        price: 100,
        range: 0.02,
      },
      {
        type: 'gap',
        durationSec: 1,
        targetPrice: 85, // 瞬间跌到 85
      },
      {
        type: 'range',
        durationSec: 300,
        price: 85,
        range: 0.02,
      },
    ],
  },

  // 快速振荡（测试订单密集度）
  'high-volatility': {
    name: 'High Volatility',
    description: '高频振荡 5 分钟，振幅 3%',
    startPrice: 100,
    phases: [
      {
        type: 'range',
        durationSec: 300,
        price: 100,
        range: 0.03, // ±3%
      },
    ],
  },

  // 极端行情（测试风控）
  'extreme-dump': {
    name: 'Extreme Dump',
    description: '暴跌 30%',
    startPrice: 100,
    phases: [
      {
        type: 'range',
        durationSec: 60,
        price: 100,
        range: 0.02,
      },
      {
        type: 'dump',
        durationSec: 30,
        change: -0.30, // -30%
      },
      {
        type: 'range',
        durationSec: 300,
        price: 70,
        range: 0.02,
      },
    ],
  },
};

/**
 * 场景验证
 */
export function validateScenario(scenario: Scenario): void {
  if (!scenario.phases || scenario.phases.length === 0) {
    throw new Error('Scenario must have at least one phase');
  }

  for (const phase of scenario.phases) {
    if (phase.durationSec <= 0) {
      throw new Error(`Phase duration must be positive: ${phase.durationSec}`);
    }

    switch (phase.type) {
      case 'range':
        if (phase.price === undefined || phase.range === undefined) {
          throw new Error('Range phase requires price and range');
        }
        if (phase.range <= 0 || phase.range >= 1) {
          throw new Error('Range must be between 0 and 1');
        }
        break;

      case 'trend':
      case 'pump':
      case 'dump':
        if (phase.change === undefined) {
          throw new Error(`${phase.type} phase requires change`);
        }
        break;

      case 'gap':
        if (phase.targetPrice === undefined) {
          throw new Error('Gap phase requires targetPrice');
        }
        break;

      default:
        throw new Error(`Unknown phase type: ${(phase as any).type}`);
    }
  }
}
