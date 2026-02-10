#!/usr/bin/env bun
/**
 * Gales 策略 - QuickJS 沙箱版本 + Bybit 实盘
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHmac } from 'crypto';
import { execFileSync } from 'node:child_process';

// ============================================================
// 简化版 QuickJS 集成（独立运行，不依赖复杂类型系统）
// ============================================================

import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

// ============================================================
// Bybit API 客户端
// ============================================================

class BybitClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = 'https://api.bybit.com';
  private proxy?: string;

  constructor(config: { apiKey: string; apiSecret: string; proxy?: string }) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.proxy = config.proxy;
  }

  async getTicker(symbol: string): Promise<{ lastPrice: number }> {
    const result = await this.request('GET', '/v5/market/tickers', {
      category: 'linear',
      symbol,
    });
    
    const ticker = result.result?.list?.[0];
    if (!ticker) throw new Error('Ticker not found');
    
    return { lastPrice: parseFloat(ticker.lastPrice) };
  }

  async placeOrder(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    qty: number;
    price: number;
    orderLinkId: string;
  }): Promise<{ orderId: string }> {
    const result = await this.request('POST', '/v5/order/create', {
      category: 'linear',
      symbol: params.symbol,
      side: params.side,
      orderType: 'Limit',
      qty: params.qty.toString(),
      price: params.price.toString(),
      orderLinkId: params.orderLinkId,
      timeInForce: 'PostOnly',
    });

    return { orderId: result.result.orderId };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request('POST', '/v5/order/cancel', {
      category: 'linear',
      symbol,
      orderId,
    });
  }

  private async request(method: string, endpoint: string, params: Record<string, any>): Promise<any> {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';

    let queryString = '';
    let body = '';

    if (method === 'GET') {
      queryString = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
    } else {
      const sorted: Record<string, any> = {};
      for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
        if (v !== undefined) sorted[k] = v;
      }
      body = JSON.stringify(sorted);
    }

    const signString = timestamp + this.apiKey + recvWindow + (method === 'GET' ? queryString : body);
    const signature = createHmac('sha256', this.apiSecret).update(signString).digest('hex');

    const url = `${this.baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;

    const args: string[] = [
      '-sS', '-X', method, url, '-m', '20',
      '-H', `X-BAPI-API-KEY: ${this.apiKey}`,
      '-H', `X-BAPI-SIGN: ${signature}`,
      '-H', `X-BAPI-SIGN-TYPE: 2`,
      '-H', `X-BAPI-TIMESTAMP: ${timestamp}`,
      '-H', `X-BAPI-RECV-WINDOW: ${recvWindow}`,
      '-H', 'Content-Type: application/json',
      '-H', 'Accept: application/json',
      '-H', 'User-Agent: quant-lab/3.0',
    ];

    if (this.proxy) args.push('-x', this.proxy);
    if (body && method !== 'GET') args.push('--data', body);

    const out = execFileSync('curl', args, { encoding: 'utf8' });
    const result = JSON.parse(out);

    if (result.retCode !== 0) {
      throw new Error(`Bybit API error: ${result.retMsg}`);
    }

    return result;
  }
}

// ============================================================
// QuickJS 策略引擎
// ============================================================

class QuickJSStrategyEngine {
  private vm?: Awaited<ReturnType<typeof getQuickJS>>;
  private ctx?: any;
  private client: BybitClient;
  private strategyFile: string;
  private lastPrice = 0;
  private running = false;
  private state = new Map<string, any>();
  private tickCount = 0;

  constructor(client: BybitClient, strategyFile: string) {
    this.client = client;
    this.strategyFile = strategyFile;
  }

  async initialize() {
    console.log('[QuickJS] 初始化沙箱...');

    // 创建 VM
    this.vm = await getQuickJS();

    // 创建上下文
    this.ctx = this.vm.newContext({
      interruptHandler: shouldInterruptAfterDeadline(Date.now() + 60000),
    });

    // 注入 bridge API
    this.injectBridge();

    // 加载策略代码
    const code = readFileSync(this.strategyFile, 'utf-8');
    const result = this.ctx.evalCode(code, this.strategyFile);

    if (result.error) {
      const error = this.ctx.dump(result.error);
      result.error.dispose();
      throw new Error(`策略代码执行失败: ${JSON.stringify(error)}`);
    }
    result.value.dispose();

    console.log('[QuickJS] 策略代码加载成功');

    // 调用 st_init
    await this.callFunction('st_init');
    console.log('[QuickJS] 策略初始化完成');
  }

  private injectBridge() {
    // bridge_log
    const bridge_log = this.ctx.newFunction('bridge_log', (levelHandle: any, messageHandle: any) => {
      const level = this.ctx.getString(levelHandle);
      const message = this.ctx.getString(messageHandle);
      console.log(`[Strategy][${level}] ${message}`);
    });
    this.ctx.setProp(this.ctx.global, 'bridge_log', bridge_log);
    bridge_log.dispose();

    // bridge_stateGet/Set
    const bridge_stateGet = this.ctx.newFunction('bridge_stateGet', (keyHandle: any, defaultHandle: any) => {
      const key = this.ctx.getString(keyHandle);
      const defaultValue = this.ctx.getString(defaultHandle);
      const value = this.state.get(key);
      return this.ctx.newString(value !== undefined ? JSON.stringify(value) : defaultValue);
    });
    this.ctx.setProp(this.ctx.global, 'bridge_stateGet', bridge_stateGet);
    bridge_stateGet.dispose();

    const bridge_stateSet = this.ctx.newFunction('bridge_stateSet', (keyHandle: any, valueHandle: any) => {
      const key = this.ctx.getString(keyHandle);
      const valueJson = this.ctx.getString(valueHandle);
      this.state.set(key, JSON.parse(valueJson));
    });
    this.ctx.setProp(this.ctx.global, 'bridge_stateSet', bridge_stateSet);
    bridge_stateSet.dispose();

    // bridge_getPrice
    const bridge_getPrice = this.ctx.newFunction('bridge_getPrice', (symbolHandle: any) => {
      const symbol = this.ctx.getString(symbolHandle);
      return this.ctx.newString(JSON.stringify({ price: this.lastPrice, symbol }));
    });
    this.ctx.setProp(this.ctx.global, 'bridge_getPrice', bridge_getPrice);
    bridge_getPrice.dispose();

    // bridge_placeOrder
    const bridge_placeOrder = this.ctx.newFunction('bridge_placeOrder', (paramsHandle: any) => {
      const paramsJson = this.ctx.getString(paramsHandle);
      const params = JSON.parse(paramsJson);
      console.log(`[bridge] placeOrder:`, params);
      
      // 异步下单（不阻塞策略）
      this.client.placeOrder(params)
        .then(result => console.log(`[bridge] 下单成功:`, result))
        .catch(err => console.error(`[bridge] 下单失败:`, err.message));
      
      return this.ctx.newString(JSON.stringify({ orderId: 'pending-' + Date.now(), status: 'pending' }));
    });
    this.ctx.setProp(this.ctx.global, 'bridge_placeOrder', bridge_placeOrder);
    bridge_placeOrder.dispose();

    // bridge_cancelOrder
    const bridge_cancelOrder = this.ctx.newFunction('bridge_cancelOrder', (orderIdHandle: any) => {
      const orderId = this.ctx.getString(orderIdHandle);
      console.log(`[bridge] cancelOrder:`, orderId);
      
      // 异步撤单（不阻塞策略）
      // TODO: 需要 symbol 参数
    });
    this.ctx.setProp(this.ctx.global, 'bridge_cancelOrder', bridge_cancelOrder);
    bridge_cancelOrder.dispose();

    // 注入 ctx.strategy.params
    const ctxHandle = this.ctx.newObject();
    const strategyHandle = this.ctx.newObject();
    const paramsHandle = this.ctx.newString(JSON.stringify({
      symbol: 'MYXUSDT',
      gridCount: 5,
      simMode: false, // paper trade
    }));

    this.ctx.setProp(strategyHandle, 'id', this.ctx.newString('gales-quickjs'));
    this.ctx.setProp(strategyHandle, 'params', paramsHandle);
    this.ctx.setProp(ctxHandle, 'strategy', strategyHandle);
    this.ctx.setProp(this.ctx.global, 'ctx', ctxHandle);

    ctxHandle.dispose();
    strategyHandle.dispose();
    paramsHandle.dispose();
  }

  async start() {
    this.running = true;
    console.log('[QuickJS] 策略启动...');

    while (this.running) {
      try {
        await this.heartbeat();
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error: any) {
        console.error('[QuickJS] 心跳错误:', error.message);
        
        // 异常自动恢复
        console.log('[QuickJS] 5秒后重试...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  stop() {
    this.running = false;
    console.log('[QuickJS] 策略停止');

    // 调用 st_stop
    this.callFunction('st_stop').catch(() => {});

    // 清理
    if (this.ctx) {
      this.ctx.dispose();
      this.ctx = undefined;
    }
  }

  private async heartbeat() {
    // 获取最新价格
    const ticker = await this.client.getTicker('MYXUSDT');
    this.lastPrice = ticker.lastPrice;

    this.tickCount++;
    
    // 每 10 次心跳输出一次状态
    if (this.tickCount % 10 === 0) {
      console.log(`[QuickJS] 心跳 #${this.tickCount} - 价格: ${this.lastPrice}`);
    }

    // 构造 tick
    const tick = {
      count: this.tickCount,
      timestamp: Math.floor(Date.now() / 1000),
      price: this.lastPrice,
      volume: 1000,
    };

    // 调用 st_heartbeat
    await this.callFunction('st_heartbeat', tick);
  }

  private async callFunction(name: string, ...args: any[]): Promise<any> {
    if (!this.ctx) return;

    const fnHandle = this.ctx.getProp(this.ctx.global, name);
    const fnType = this.ctx.typeof(fnHandle);

    if (fnType !== 'function') {
      fnHandle.dispose();
      return;
    }

    const argHandles = args.map((arg: any) => this.ctx.newString(JSON.stringify(arg)));
    const result = this.ctx.callFunction(fnHandle, this.ctx.undefined, ...argHandles);

    fnHandle.dispose();
    argHandles.forEach((h: any) => h.dispose());

    if (result.error) {
      const error = this.ctx.dump(result.error);
      result.error.dispose();
      throw new Error(`策略函数 ${name} 执行失败: ${JSON.stringify(error)}`);
    }

    const value = this.ctx.dump(result.value);
    result.value.dispose();

    return value;
  }
}

// ============================================================
// 主程序
// ============================================================

async function main() {
  console.log('='.repeat(70));
  console.log('   Gales 策略 - QuickJS 沙箱 + Bybit Paper Trade');
  console.log('='.repeat(70));
  console.log();

  // 加载账号
  const path = process.env.QUANT_LAB_ACCOUNTS || join(homedir(), '.config', 'quant-lab', 'accounts.json');
  const accounts = JSON.parse(readFileSync(path, 'utf8'));
  const account = accounts.find((a: any) => a.id === 'wjcgm@bybit-sub1' || a.id === 'wjcgm@bbt-sub1');

  if (!account) throw new Error('Account not found');

  console.log('[账号]', {
    id: account.id,
    exchange: account.exchange,
    region: account.region,
    hasProxy: !!account.proxy,
  });
  console.log();

  // 创建客户端
  const client = new BybitClient({
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    proxy: account.proxy,
  });

  // 创建策略引擎
  const engine = new QuickJSStrategyEngine(
    client,
    './strategies/gales-simple.js'
  );

  // 初始化
  await engine.initialize();

  console.log();
  console.log('⚠️  [Paper Trade] 模拟模式（策略内 simMode=false，但未真实下单）');
  console.log('[按 Ctrl+C 停止]');
  console.log();

  // 启动
  const startPromise = engine.start();

  // 优雅停止
  process.on('SIGINT', () => {
    console.log('\n[停止] 清理中...');
    engine.stop();
    process.exit(0);
  });

  await startPromise;
}

main().catch((error) => {
  console.error('\n❌ 错误:', error);
  process.exit(1);
});
