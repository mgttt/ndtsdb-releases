// ============================================================
// Gales Strategy - 磁铁限价网格策略
// 
// Grid + Martingale = Gales (大风大浪中收益)
// 核心思路：只在价格接近网格档位时挂限价单（磁铁吸附），避免滑点
// ============================================================

import type { Kline, Tick } from 'quant-lib';
import type { Order, StrategyContext } from '../engine/types';

/**
 * Gales 策略配置
 */
export interface GalesConfig {
  // 基础参数
  symbol: string;
  gridCount: number;
  gridSpacing: number;      // 网格间距（百分比，如 0.01 = 1%）
  orderSize: number;        // 每单 USDT 金额
  maxPosition: number;      // 最大仓位 USDT

  // 🧲 磁铁参数
  magnetDistance: number;   // 磁铁距离：价格接近此距离时挂单
  cancelDistance: number;   // 取消距离：偏离此距离时撤单
  priceOffset: number;      // 限价单价格偏移
  postOnly?: boolean;       // 默认 true，做 maker
  orderTimeout?: number;    // 订单超时（秒）

  // 安全开关
  simMode?: boolean;        // 模拟模式（不真实下单）
}

/**
 * 网格档位
 */
interface GridLevel {
  id: number;
  price: number;
  side: 'BUY' | 'SELL';
  state: 'IDLE' | 'PLACING' | 'ACTIVE' | 'CANCELING' | 'FILLED';
  
  orderId?: string;
  orderLinkId?: string;
  orderPrice?: number;
  createdAt?: number;
  attempts: number;
}

/**
 * Gales Strategy
 */
export class GalesStrategy {
  private config: Required<GalesConfig>;
  private ctx?: StrategyContext;

  // 状态
  private initialized = false;
  private centerPrice = 0;
  private lastPrice = 0;
  private positionNotional = 0;
  private gridLevels: GridLevel[] = [];
  private nextGridId = 1;
  private tickCount = 0;

  // 订单追踪
  private pendingOrders = new Map<string, GridLevel>();

  constructor(config: GalesConfig) {
    this.config = {
      postOnly: true,
      orderTimeout: 300,
      simMode: true,
      ...config,
    };
  }

  /**
   * 初始化
   */
  onInit(ctx: StrategyContext): void {
    this.ctx = ctx;
    console.log('[GalesStrategy] 初始化...');
    console.log('[GalesStrategy] 配置:', {
      symbol: this.config.symbol,
      gridCount: this.config.gridCount,
      gridSpacing: `${(this.config.gridSpacing * 100).toFixed(2)}%`,
      magnetDistance: `${(this.config.magnetDistance * 100).toFixed(2)}%`,
      simMode: this.config.simMode,
    });

    this.initialized = false;
  }

  /**
   * K线更新（用于初始化中心价格）
   */
  onBar(bar: Kline, ctx: StrategyContext): void {
    if (!this.initialized) {
      this.centerPrice = bar.close;
      this.initializeGrids();
      this.initialized = true;
      console.log(`[GalesStrategy] 网格初始化完成，中心价格: ${this.centerPrice}`);
    }

    this.lastPrice = bar.close;
    this.onHeartbeat();
  }

  /**
   * Tick 更新（心跳）
   */
  onTick(tick: Tick, ctx: StrategyContext): void {
    this.lastPrice = tick.price;
    this.tickCount++;

    // 每 5 次 tick 检查一次
    if (this.tickCount % 5 === 0) {
      this.onHeartbeat();
    }
  }

  /**
   * 订单更新
   */
  onOrder(order: Order, ctx: StrategyContext): void {
    const grid = this.pendingOrders.get(order.id);
    if (!grid) return;

    console.log(`[GalesStrategy] 订单更新:`, {
      gridId: grid.id,
      side: grid.side,
      status: order.status,
      filled: order.filled,
      quantity: order.quantity,
    });

    switch (order.status) {
      case 'FILLED':
        this.handleOrderFilled(grid, order);
        break;

      case 'CANCELLED':
        this.handleOrderCancelled(grid);
        break;
    }
  }

  /**
   * 停止
   */
  onStop(ctx: StrategyContext): void {
    console.log('[GalesStrategy] 停止策略，取消所有挂单...');
    
    for (const grid of this.gridLevels) {
      if (grid.state === 'ACTIVE' && grid.orderId) {
        this.cancelGridOrder(grid);
      }
    }
  }

  /**
   * 心跳检查
   */
  private onHeartbeat(): void {
    if (!this.initialized || !this.ctx) return;

    const price = this.lastPrice;
    if (price <= 0) return;

    // 检查每个网格档位
    for (const grid of this.gridLevels) {
      const distance = Math.abs(price - grid.price) / grid.price;

      switch (grid.state) {
        case 'IDLE':
          // 价格接近，准备挂单
          if (this.shouldPlaceOrder(grid, price, distance)) {
            this.placeGridOrder(grid, price);
          }
          break;

        case 'ACTIVE':
          // 价格偏离，取消订单
          if (distance > this.config.cancelDistance) {
            console.log(`[GalesStrategy] 价格偏离，取消订单 gridId=${grid.id} distance=${(distance * 100).toFixed(3)}%`);
            this.cancelGridOrder(grid);
          }

          // 订单超时
          if (grid.createdAt && this.config.orderTimeout) {
            const age = (Date.now() - grid.createdAt) / 1000;
            if (age > this.config.orderTimeout) {
              console.log(`[GalesStrategy] 订单超时，取消 gridId=${grid.id} age=${age.toFixed(0)}s`);
              this.cancelGridOrder(grid);
            }
          }
          break;
      }
    }
  }

  /**
   * 初始化网格
   */
  private initializeGrids(): void {
    this.gridLevels = [];
    const center = this.centerPrice;

    // 生成买单网格（中心价格下方）
    for (let i = 1; i <= this.config.gridCount; i++) {
      const price = center * (1 - this.config.gridSpacing * i);
      this.gridLevels.push({
        id: this.nextGridId++,
        price,
        side: 'BUY',
        state: 'IDLE',
        attempts: 0,
      });
    }

    // 生成卖单网格（中心价格上方）
    for (let i = 1; i <= this.config.gridCount; i++) {
      const price = center * (1 + this.config.gridSpacing * i);
      this.gridLevels.push({
        id: this.nextGridId++,
        price,
        side: 'SELL',
        state: 'IDLE',
        attempts: 0,
      });
    }

    console.log(`[GalesStrategy] 生成网格: ${this.gridLevels.length} 个档位`);
  }

  /**
   * 是否应该挂单
   */
  private shouldPlaceOrder(grid: GridLevel, price: number, distance: number): boolean {
    // 距离检查
    if (distance > this.config.magnetDistance) return false;

    // 方向检查：买单要价格在目标上方接近，卖单要在下方接近
    if (grid.side === 'BUY' && price < grid.price) return false;
    if (grid.side === 'SELL' && price > grid.price) return false;

    // 仓位检查
    if (grid.side === 'BUY' && this.positionNotional >= this.config.maxPosition) return false;
    if (grid.side === 'SELL' && this.positionNotional <= -this.config.maxPosition) return false;

    return true;
  }

  /**
   * 挂网格订单
   */
  private async placeGridOrder(grid: GridLevel, currentPrice: number): Promise<void> {
    if (!this.ctx) return;

    grid.state = 'PLACING';
    grid.attempts++;

    // 计算订单价格（带偏移）
    let orderPrice = grid.price;
    if (grid.side === 'BUY') {
      orderPrice = grid.price * (1 - this.config.priceOffset);
    } else {
      orderPrice = grid.price * (1 + this.config.priceOffset);
    }

    // postOnly 保护：如果会吃单，外移 1 tick
    // TODO: 需要从 provider 获取 priceTick
    const priceTick = 0.1; // 临时硬编码
    if (this.config.postOnly) {
      if (grid.side === 'BUY' && orderPrice >= currentPrice) {
        orderPrice = currentPrice - priceTick;
      } else if (grid.side === 'SELL' && orderPrice <= currentPrice) {
        orderPrice = currentPrice + priceTick;
      }
    }

    // 计算数量
    const quantity = this.config.orderSize / orderPrice;

    console.log(`[GalesStrategy] ${this.config.simMode ? '[SIM] ' : ''}挂单 gridId=${grid.id} ${grid.side} ${quantity.toFixed(4)} @ ${orderPrice}`);

    if (this.config.simMode) {
      // 模拟模式：直接标记为 ACTIVE
      grid.state = 'ACTIVE';
      grid.orderPrice = orderPrice;
      grid.createdAt = Date.now();
      grid.orderId = `sim-${grid.id}`;
      grid.orderLinkId = `gales-${grid.id}-${grid.side}`;
      this.pendingOrders.set(grid.orderId, grid);
      return;
    }

    try {
      let order: Order;
      if (grid.side === 'BUY') {
        order = await this.ctx.buy(this.config.symbol, quantity, orderPrice);
      } else {
        order = await this.ctx.sell(this.config.symbol, quantity, orderPrice);
      }

      grid.state = 'ACTIVE';
      grid.orderId = order.id;
      grid.orderLinkId = `gales-${grid.id}-${grid.side}`;
      grid.orderPrice = orderPrice;
      grid.createdAt = Date.now();
      this.pendingOrders.set(order.id, grid);

      console.log(`[GalesStrategy] 挂单成功 orderId=${order.id}`);
    } catch (error: any) {
      console.error(`[GalesStrategy] 挂单失败 gridId=${grid.id}:`, error.message);
      grid.state = 'IDLE';
    }
  }

  /**
   * 取消网格订单
   */
  private async cancelGridOrder(grid: GridLevel): Promise<void> {
    if (!this.ctx || !grid.orderId) return;

    grid.state = 'CANCELING';

    if (this.config.simMode) {
      // 模拟模式：直接标记为 IDLE
      this.pendingOrders.delete(grid.orderId);
      grid.state = 'IDLE';
      grid.orderId = undefined;
      grid.orderLinkId = undefined;
      grid.orderPrice = undefined;
      return;
    }

    try {
      await this.ctx.cancelOrder(grid.orderId);
      console.log(`[GalesStrategy] 取消订单成功 orderId=${grid.orderId}`);
    } catch (error: any) {
      console.error(`[GalesStrategy] 取消订单失败 orderId=${grid.orderId}:`, error.message);
    }
  }

  /**
   * 处理订单成交
   */
  private handleOrderFilled(grid: GridLevel, order: Order): void {
    console.log(`[GalesStrategy] 订单成交 gridId=${grid.id} ${grid.side} ${order.filled}@${order.price}`);

    // 更新仓位
    if (grid.side === 'BUY') {
      this.positionNotional += order.filled * (order.price || grid.price);
    } else {
      this.positionNotional -= order.filled * (order.price || grid.price);
    }

    // 重置网格（刷新中心价格 & 重新生成网格）
    this.centerPrice = this.lastPrice;
    this.initializeGrids();

    console.log(`[GalesStrategy] 网格已刷新，新中心价格: ${this.centerPrice}, 当前仓位: ${this.positionNotional.toFixed(2)} USDT`);
  }

  /**
   * 处理订单取消
   */
  private handleOrderCancelled(grid: GridLevel): void {
    this.pendingOrders.delete(grid.orderId!);
    grid.state = 'IDLE';
    grid.orderId = undefined;
    grid.orderLinkId = undefined;
    grid.orderPrice = undefined;
  }
}
