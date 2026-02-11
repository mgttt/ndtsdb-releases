/**
 * Gales 策略 - QuickJS 简化版
 *
 * 磁铁限价网格策略
 */

// ================================
// 配置
// ================================

const CONFIG = {
  symbol: 'MYXUSDT',
  gridCount: 5,
  gridSpacing: 0.01,
  orderSize: 10,
  maxPosition: 100,

  magnetDistance: 0.005,     // 0.5%（扩大 2.5 倍）
  cancelDistance: 0.01,      // 1%
  priceOffset: 0.0005,
  postOnly: true,
  cooldownSec: 60,           // 60 秒冷却
  maxOrderAgeSec: 300,        // 订单最长存活时间（超时撤单）
  minOrderLifeSec: 30,        // 订单最短存活时间（避免瞬时波动撤单）
  driftConfirmCount: 2,       // 连续 N 次脱离才撤单（防止误撤）

  partialFillThreshold: 0.3,  // 部分成交达到 30% → 视为本格已成交（撤掉剩余）
  dustFillThreshold: 0.05,    // <5% 的碎片成交 → 建议走清理逻辑（暂只记录）
  hedgeDustFills: true,       // 自动对冲残余风险（不足阈值但有成交）
  maxHedgeSlippagePct: 0.005, // 对冲最大滑点容忍 0.5%

  simMode: true,
};

// 从 ctx.strategy.params 覆盖参数
if (typeof ctx !== 'undefined' && ctx && ctx.strategy && ctx.strategy.params) {
  const p = ctx.strategy.params;
  if (p.symbol) CONFIG.symbol = p.symbol;
  if (p.gridCount) CONFIG.gridCount = p.gridCount;
  if (p.simMode !== undefined) CONFIG.simMode = p.simMode;
}

// ================================
// 状态
// ================================

let state = {
  initialized: false,
  centerPrice: 0,
  lastPrice: 0,
  positionNotional: 0,
  gridLevels: [],
  nextGridId: 1,
  openOrders: [],
  tickCount: 0,
};

// 运行时状态（不持久化）
let runtime = {
  // 仓位超限告警：只在“首次进入超限”时提醒，并做时间节流
  posLimit: {
    buyOver: false,
    sellOver: false,
    lastWarnAtBuy: 0,
    lastWarnAtSell: 0,
  },
};

// 加载状态
function loadState() {
  try {
    const saved = bridge_stateGet('state', 'null');
    if (saved && saved !== 'null') {
      const obj = JSON.parse(saved);
      if (obj && typeof obj === 'object') {
        state = obj;
        // 兼容旧状态缺字段
        if (!state.openOrders) state.openOrders = [];
        if (!state.tickCount) state.tickCount = 0;
        if (!state.gridLevels) state.gridLevels = [];
        if (!state.nextGridId) state.nextGridId = 1;
      }
    }
  } catch (e) {
    logInfo('Failed to load state: ' + e);
  }
}

// 保存状态
function saveState() {
  bridge_stateSet('state', JSON.stringify(state));
}

// ================================
// 工具函数
// ================================

function logInfo(msg) {
  bridge_log('info', '[Gales] ' + msg);
}

function logWarn(msg) {
  bridge_log('warn', '[Gales] ' + msg);
}

function logDebug(msg) {
  bridge_log('debug', '[Gales] ' + msg);
}

function warnPositionLimit(side, gridId, currentNotional, afterFillNotional) {
  const now = Date.now();
  const intervalMs = 5 * 60 * 1000; // 5 分钟提醒一次足够了

  if (side === 'Buy') {
    if (runtime.posLimit.buyOver && (now - runtime.posLimit.lastWarnAtBuy) < intervalMs) return;
    runtime.posLimit.buyOver = true;
    runtime.posLimit.lastWarnAtBuy = now;
    logWarn('买单 #' + gridId + ' 仓位将超限 (当前=' + currentNotional.toFixed(2) + ' 成交后=' + afterFillNotional.toFixed(2) + ')');
    return;
  }

  if (side === 'Sell') {
    if (runtime.posLimit.sellOver && (now - runtime.posLimit.lastWarnAtSell) < intervalMs) return;
    runtime.posLimit.sellOver = true;
    runtime.posLimit.lastWarnAtSell = now;
    logWarn('卖单 #' + gridId + ' 仓位将超限 (当前=' + currentNotional.toFixed(2) + ' 成交后=' + afterFillNotional.toFixed(2) + ')');
  }
}

// ================================
// 订单管理（sim + 真实共用）
// ================================

function getOpenOrder(orderId) {
  if (!orderId) return null;
  for (let i = 0; i < state.openOrders.length; i++) {
    const o = state.openOrders[i];
    if (o.orderId === orderId) return o;
  }
  return null;
}

function removeOpenOrder(orderId) {
  if (!orderId) return;
  state.openOrders = state.openOrders.filter(function(o) { return o.orderId !== orderId; });
}

function findActiveOrderByGridId(gridId) {
  if (!gridId) return null;
  for (let i = 0; i < state.openOrders.length; i++) {
    const o = state.openOrders[i];
    if (!o) continue;
    if (o.gridId !== gridId) continue;
    if (o.status === 'Filled' || o.status === 'Canceled') continue;
    return o;
  }
  return null;
}

function syncGridFromOrder(grid, order) {
  if (!grid || !order) return;
  grid.state = 'ACTIVE';
  grid.orderId = order.orderId;
  grid.orderLinkId = order.orderLinkId;
  grid.orderPrice = order.price;
  grid.orderQty = order.qty;
  grid.cumQty = order.cumQty || 0;
  grid.avgFillPrice = order.avgPrice || 0;
  grid.createdAt = order.createdAt || grid.createdAt || Date.now();
}

// 修复/对齐 grid <-> openOrders 的一致性，避免重复挂单
function reconcileGridOrderLinks() {
  if (!state.gridLevels || state.gridLevels.length === 0) return;

  // 1) 如果 openOrders 里存在活跃订单，但 grid 却是 IDLE，则纠正为 ACTIVE
  for (let i = 0; i < state.openOrders.length; i++) {
    const o = state.openOrders[i];
    if (!o || !o.gridId) continue;
    if (o.status === 'Filled' || o.status === 'Canceled') continue;

    const g = findGridById(o.gridId);
    if (!g) continue;
    if (g.state !== 'ACTIVE' || g.orderId !== o.orderId) {
      syncGridFromOrder(g, o);
    }
  }

  // 2) 如果 grid 标记 ACTIVE 但找不到订单，则回收为 IDLE
  for (let i = 0; i < state.gridLevels.length; i++) {
    const g = state.gridLevels[i];
    if (!g) continue;
    if (g.state !== 'ACTIVE') continue;

    const o = getOpenOrder(g.orderId);
    if (!o || o.status === 'Filled' || o.status === 'Canceled') {
      g.state = 'IDLE';
      g.orderId = undefined;
      g.orderLinkId = undefined;
      g.orderPrice = undefined;
      g.orderQty = undefined;
    }
  }
}

function updatePositionFromFill(side, fillQty, fillPrice) {
  const notional = fillQty * fillPrice;
  if (side === 'Buy') state.positionNotional += notional;
  else state.positionNotional -= notional;
}

// 统一入口：订单状态更新（未来接 WebSocket 时也走这里）
function onOrderUpdate(order) {
  const local = getOpenOrder(order.orderId);
  if (!local) return;

  // 增量成交处理（避免重复累计）
  const prevCum = local.cumQty || 0;
  const nextCum = order.cumQty || 0;
  const delta = nextCum - prevCum;

  local.status = order.status;
  local.cumQty = nextCum;
  local.avgPrice = order.avgPrice || local.avgPrice || local.price;
  local.updatedAt = Date.now();

  if (delta > 0) {
    updatePositionFromFill(local.side, delta, local.avgPrice);
    logInfo('[成交增量] orderId=' + local.orderId + ' +' + delta.toFixed(4) + ' @ ' + local.avgPrice.toFixed(4) + ' | 仓位Notional=' + state.positionNotional.toFixed(2));
  }
}

/**
 * simMode: 模拟成交（用于在 paper trade 中验证部分成交策略）
 */
function simulateFillsIfNeeded() {
  if (!CONFIG.simMode) return;
  if (!state.openOrders || state.openOrders.length === 0) return;

  for (let i = 0; i < state.openOrders.length; i++) {
    const o = state.openOrders[i];
    if (!o || o.status === 'Filled' || o.status === 'Canceled') continue;

    // 限价单成交条件：
    // Buy: 市价 <= 限价
    // Sell: 市价 >= 限价
    const canFill = (o.side === 'Buy')
      ? (state.lastPrice <= o.price)
      : (state.lastPrice >= o.price);

    if (!canFill) continue;

    // 每次心跳最多成交 40% 剩余量（模拟"部分成交"）
    const remaining = o.qty - (o.cumQty || 0);
    if (remaining <= 0) continue;

    const fillQty = Math.min(remaining, o.qty * 0.4);
    const nextCum = (o.cumQty || 0) + fillQty;
    const status = nextCum >= o.qty ? 'Filled' : 'PartiallyFilled';

    onOrderUpdate({
      orderId: o.orderId,
      status: status,
      cumQty: nextCum,
      avgPrice: o.price,
    });
  }
}

function findGridById(gridId) {
  for (let i = 0; i < state.gridLevels.length; i++) {
    if (state.gridLevels[i].id === gridId) return state.gridLevels[i];
  }
  return null;
}

function recordFill(grid, order, reason) {
  const fillPct = order.qty > 0 ? ((order.cumQty || 0) / order.qty) : 0;
  grid.lastFillPct = fillPct;
  grid.lastFillQty = order.cumQty || 0;
  grid.lastFillPrice = order.avgPrice || order.price;
  grid.lastFillReason = reason;
  grid.lastFillAt = Date.now();
}

/**
 * 增强 2: 对冲残余风险（碎片/不足阈值的部分成交）
 */
function hedgeResidual(grid, order) {
  if (!CONFIG.hedgeDustFills) return;
  if (!order || !order.cumQty || order.cumQty <= 0) return;

  const residualQty = order.cumQty;
  const hedgeSide = (order.side === 'Buy') ? 'Sell' : 'Buy';

  logInfo('[对冲残余] gridId=' + grid.id + ' side=' + hedgeSide + ' qty=' + residualQty.toFixed(4) + ' @ market');

  if (CONFIG.simMode) {
    // simMode: 模拟对冲成交（按当前价）
    updatePositionFromFill(hedgeSide, residualQty, state.lastPrice);
    logInfo('[SIM] 对冲成交 @ ' + state.lastPrice.toFixed(4) + ' | 仓位Notional=' + state.positionNotional.toFixed(2));
    return;
  }

  // 真实下单：市价单对冲
  try {
    const hedgeParams = {
      symbol: CONFIG.symbol,
      side: hedgeSide,
      qty: residualQty,
      orderType: 'Market',
    };

    const result = bridge_placeOrder(JSON.stringify(hedgeParams));
    logInfo('✅ 对冲成功: ' + result);
  } catch (e) {
    logWarn('❌ 对冲失败: ' + e);
  }
}

// ACTIVE 网格的风险/策略处理：超时、脱离、部分成交决策
function applyActiveOrderPolicy(grid, distance) {
  const order = getOpenOrder(grid.orderId);
  if (!order) {
    // 订单丢失：直接回到 IDLE
    grid.state = 'IDLE';
    grid.orderId = undefined;
    return;
  }

  // 订单已完全成交：记录并释放网格（允许后续再次交易）
  if (order.status === 'Filled') {
    recordFill(grid, order, 'filled');
    logInfo('[完全成交] gridId=' + grid.id + ' fillQty=' + (order.cumQty || 0).toFixed(4) + ' @ ' + (order.avgPrice || order.price).toFixed(4));
    removeOpenOrder(order.orderId);
    grid.state = 'IDLE';
    grid.orderId = undefined;
    grid.orderLinkId = undefined;
    grid.orderPrice = undefined;
    return;
  }

  // 超时撤单
  const ageSec = (Date.now() - (order.createdAt || Date.now())) / 1000;
  if (ageSec > CONFIG.maxOrderAgeSec) {
    const fillPct = order.qty > 0 ? ((order.cumQty || 0) / order.qty) : 0;
    logWarn('[订单超时] gridId=' + grid.id + ' ageSec=' + ageSec.toFixed(0) + ' fillPct=' + (fillPct * 100).toFixed(1) + '%');

    // 超时：有部分成交也撤掉剩余
    cancelOrder(grid);
    removeOpenOrder(order.orderId);

    if (order.cumQty > 0) {
      recordFill(grid, order, 'timeout');
      // 关键：是否"视为完全成交"？用 partialFillThreshold 判定
      if (fillPct >= CONFIG.partialFillThreshold) {
        logInfo('[超时-部分成交视为完成] gridId=' + grid.id + ' fillPct=' + (fillPct * 100).toFixed(1) + '%');
      } else if (fillPct < CONFIG.dustFillThreshold) {
        logWarn('[超时-碎片成交] gridId=' + grid.id + ' fillPct=' + (fillPct * 100).toFixed(1) + '%');
        // 增强 2: 对冲碎片残余风险
        hedgeResidual(grid, order);
      } else {
        logWarn('[超时-部分成交不足阈值] gridId=' + grid.id + ' fillPct=' + (fillPct * 100).toFixed(1) + '%');
        // 增强 2: 对冲不足阈值的残余风险
        hedgeResidual(grid, order);
      }
    }

    return;
  }

  // 价格脱离撤单（包含"部分成交 + 脱离"的关键场景）
  if (distance > CONFIG.cancelDistance) {
    // 增强 1: 防止瞬时波动撤单 - 检查订单最短存活时间
    if (ageSec < CONFIG.minOrderLifeSec) {
      // 订单还太新，不撤单（避免瞬时波动误撤）
      grid.driftCount = (grid.driftCount || 0);
      return;
    }

    // 增强 1: 连续脱离计数
    grid.driftCount = (grid.driftCount || 0) + 1;

    if (grid.driftCount < CONFIG.driftConfirmCount) {
      // 还未达到连续脱离次数，不撤单
      logDebug('[价格脱离 ' + grid.driftCount + '/' + CONFIG.driftConfirmCount + '] gridId=' + grid.id + ' dist=' + (distance * 100).toFixed(2) + '%');
      return;
    }

    // 达到连续脱离次数，执行撤单
    const fillPct = order.qty > 0 ? ((order.cumQty || 0) / order.qty) : 0;

    if ((order.cumQty || 0) > 0) {
      logWarn('[价格脱离+部分成交] gridId=' + grid.id +
        ' dist=' + (distance * 100).toFixed(2) + '% fillPct=' + (fillPct * 100).toFixed(1) + '% driftCount=' + grid.driftCount);

      // 决策：撤掉剩余（避免长期挂单）
      cancelOrder(grid);
      removeOpenOrder(order.orderId);
      recordFill(grid, order, 'drift');

      // 是否把"这一条 gale"视为完全成交？
      if (fillPct >= CONFIG.partialFillThreshold) {
        logInfo('[部分成交视为完成] gridId=' + grid.id + ' fillPct=' + (fillPct * 100).toFixed(1) + '%');
      } else if (fillPct < CONFIG.dustFillThreshold) {
        logWarn('[碎片成交] gridId=' + grid.id + ' fillPct=' + (fillPct * 100).toFixed(1) + '%（建议后续做碎片清理单）');
        // 增强 2: 对冲碎片残余风险
        hedgeResidual(grid, order);
      } else {
        logWarn('[部分成交不足阈值] gridId=' + grid.id + ' fillPct=' + (fillPct * 100).toFixed(1) + '%');
        // 增强 2: 对冲不足阈值的残余风险
        hedgeResidual(grid, order);
      }
    } else {
      // 无成交：直接撤单
      logInfo('[价格偏离-无成交] gridId=' + grid.id + ' dist=' + (distance * 100).toFixed(2) + '% driftCount=' + grid.driftCount);
      cancelOrder(grid);
      removeOpenOrder(order.orderId);
    }

    // 重置 driftCount
    grid.driftCount = 0;
  } else {
    // 价格回到正常范围，重置连续脱离计数
    if (grid.driftCount > 0) {
      logDebug('[价格回归] gridId=' + grid.id + ' 重置 driftCount');
      grid.driftCount = 0;
    }
  }
}

/**
 * 订单推送回调（为实盘预留：WebSocket 收到订单更新时调用）
 */
function st_onOrderUpdate(orderJson) {
  try {
    const order = (typeof orderJson === 'string') ? JSON.parse(orderJson) : orderJson;
    if (!order || !order.orderId) return;

    onOrderUpdate(order);

    // 同步 grid 状态（如果能定位到 grid）
    if (order.gridId) {
      const grid = findGridById(order.gridId);
      if (grid && grid.orderId === order.orderId) {
        // 让 policy 在下一次 heartbeat 统一处理
        grid.lastExternalUpdateAt = Date.now();
      }
    }

    saveState();
  } catch (e) {
    logWarn('st_onOrderUpdate parse failed: ' + e);
  }
}

/**
 * 心跳日志（每 10 次输出一次）
 */
function logHeartbeat() {
  const activeOrders = state.openOrders.length;
  const nearestGrid = findNearestGrid();

  let msg = '[心跳 #' + state.tickCount + '] 价格: ' + state.lastPrice.toFixed(4);

  if (nearestGrid) {
    const distance = (Math.abs(state.lastPrice - nearestGrid.price) / nearestGrid.price * 100).toFixed(2);
    msg += ' | 最近网格: ' + nearestGrid.side + ' ' + nearestGrid.price.toFixed(4);
    msg += ' (距离 ' + distance + '%)';
  }

  msg += ' | 活跃订单: ' + activeOrders;

  logInfo(msg);
}

/**
 * 找到最近的网格
 */
function findNearestGrid() {
  if (!state.gridLevels || state.gridLevels.length === 0) return null;

  let nearest = state.gridLevels[0];
  let minDistance = Math.abs(state.lastPrice - nearest.price);

  for (let i = 1; i < state.gridLevels.length; i++) {
    const grid = state.gridLevels[i];
    const distance = Math.abs(state.lastPrice - grid.price);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = grid;
    }
  }

  return nearest;
}

/**
 * 打印网格状态
 */
function printGridStatus() {
  logInfo('=== 网格档位 ===');

  const buyGrids = state.gridLevels.filter(function(g) { return g.side === 'Buy'; });
  const sellGrids = state.gridLevels.filter(function(g) { return g.side === 'Sell'; });

  logInfo('买单网格 (' + buyGrids.length + ' 个):');
  buyGrids.forEach(function(g) {
    logInfo('  #' + g.id + ' @ ' + g.price.toFixed(4) + ' [' + g.state + ']');
  });

  logInfo('卖单网格 (' + sellGrids.length + ' 个):');
  sellGrids.forEach(function(g) {
    logInfo('  #' + g.id + ' @ ' + g.price.toFixed(4) + ' [' + g.state + ']');
  });

  logInfo('磁铁距离: ' + (CONFIG.magnetDistance * 100).toFixed(2) + '%');
  logInfo('取消距离: ' + (CONFIG.cancelDistance * 100).toFixed(2) + '%');
}

// ================================
// 生命周期函数
// ================================

/**
 * 初始化
 */
function st_init() {
  logInfo('策略初始化...');
  logInfo('Symbol: ' + CONFIG.symbol);
  logInfo('GridCount: ' + CONFIG.gridCount);
  logInfo('SimMode: ' + CONFIG.simMode);

  loadState();
}

/**
 * 心跳
 */
function st_heartbeat(tickJson) {
  // QuickJS 传递的是 JSON 字符串
  const tick = (typeof tickJson === 'string') ? JSON.parse(tickJson) : tickJson;

  if (!tick || !tick.price) return;

  state.lastPrice = tick.price;
  state.tickCount = (state.tickCount || 0) + 1;

  // 首次初始化网格
  if (!state.initialized) {
    state.centerPrice = tick.price;
    initializeGrids();
    state.initialized = true;
    logInfo('网格初始化完成，中心价格: ' + state.centerPrice);
    printGridStatus();
    saveState();
    return;
  }

  // 每 10 次心跳输出一次状态（避免刷屏）
  if (state.tickCount % 10 === 0) {
    logHeartbeat();
  }

  // 修复 grid/openOrders 不一致（避免重复挂单/状态漂移）
  reconcileGridOrderLinks();

  // simMode: 先模拟成交，方便在 paper trade 中验证"部分成交"策略
  simulateFillsIfNeeded();

  // 成交/状态更新后再对齐一次
  reconcileGridOrderLinks();

  // 检查网格
  for (let i = 0; i < state.gridLevels.length; i++) {
    const grid = state.gridLevels[i];
    const distance = Math.abs(state.lastPrice - grid.price) / grid.price;

    if (grid.state === 'IDLE') {
      if (shouldPlaceOrder(grid, distance)) {
        placeOrder(grid);
      }
    } else if (grid.state === 'ACTIVE') {
      applyActiveOrderPolicy(grid, distance);
    }
  }

  // 心跳末尾持久化（确保部分成交/对冲/撤单等状态不丢）
  saveState();
}

/**
 * 参数热更新（不重启沙箱）
 */
function st_onParamsUpdate(newParamsJson) {
  const newParams = (typeof newParamsJson === 'string') ? JSON.parse(newParamsJson) : newParamsJson;

  logInfo('[Gales] 参数热更新: ' + JSON.stringify(newParams));

  // 更新配置
  if (newParams.gridCount !== undefined) {
    CONFIG.gridCount = newParams.gridCount;
    logInfo('[Gales] 网格数量: ' + CONFIG.gridCount);
  }
  if (newParams.gridSpacing !== undefined) {
    CONFIG.gridSpacing = newParams.gridSpacing;
    logInfo('[Gales] 网格间距: ' + CONFIG.gridSpacing);
  }
  if (newParams.magnetDistance !== undefined) {
    CONFIG.magnetDistance = newParams.magnetDistance;
    logInfo('[Gales] 磁铁距离: ' + CONFIG.magnetDistance);
  }
  if (newParams.cancelDistance !== undefined) {
    CONFIG.cancelDistance = newParams.cancelDistance;
    logInfo('[Gales] 取消距离: ' + CONFIG.cancelDistance);
  }

  // 重新初始化网格（保持当前价格）
  if (state.initialized) {
    logInfo('[Gales] 重新初始化网格（中心价格: ' + state.lastPrice + '）');
    state.centerPrice = state.lastPrice;
    initializeGrids();
  }

  // 可选：撤销旧订单
  const cancelOldOrders = newParams.cancelOldOrders || false;
  if (cancelOldOrders && state.openOrders.length > 0) {
    logInfo('[Gales] 撤销旧订单: ' + state.openOrders.length + ' 个');
    state.openOrders.forEach(function(order) {
      bridge_cancelOrder(order.orderId);
    });
    state.openOrders = [];
  }

  saveState();
  logInfo('[Gales] 参数热更新完成');
}

/**
 * 停止
 */
function st_stop() {
  logInfo('策略停止');
  saveState();
}

// ================================
// 网格管理
// ================================

function initializeGrids() {
  state.gridLevels = [];
  const center = state.centerPrice;

  // 买单网格
  for (let i = 1; i <= CONFIG.gridCount; i++) {
    const price = center * (1 - CONFIG.gridSpacing * i);
    state.gridLevels.push({
      id: state.nextGridId++,
      price: price,
      side: 'Buy',
      state: 'IDLE',
      attempts: 0,
      lastTriggerTime: null,
      lastTriggerPrice: null,
      driftCount: 0,
    });
  }

  // 卖单网格
  for (let i = 1; i <= CONFIG.gridCount; i++) {
    const price = center * (1 + CONFIG.gridSpacing * i);
    state.gridLevels.push({
      id: state.nextGridId++,
      price: price,
      side: 'Sell',
      state: 'IDLE',
      attempts: 0,
      lastTriggerTime: null,
      lastTriggerPrice: null,
      driftCount: 0,
    });
  }

  logInfo('生成网格: ' + state.gridLevels.length + ' 个档位');
}

function shouldPlaceOrder(grid, distance) {
  const distancePct = (distance * 100).toFixed(2);

  // 1. 磁铁检查（双向）
  if (distance > CONFIG.magnetDistance) {
    return false;  // 距离太远
  }

  // 2. 冷却时间检查（防止重复触发）
  if (grid.lastTriggerTime) {
    const cooldownMs = CONFIG.cooldownSec * 1000;
    const elapsed = Date.now() - grid.lastTriggerTime;
    if (elapsed < cooldownMs) {
      return false;  // 冷却中
    }
  }

  // 3. 防重复：如果该 grid 已存在活跃订单（但 grid 状态丢了），则修复并跳过
  const existing = findActiveOrderByGridId(grid.id);
  if (existing) {
    syncGridFromOrder(grid, existing);
    return false;
  }

  // 4. 仓位检查（考虑订单全量成交后的仓位）
  const orderNotional = CONFIG.orderSize; // 订单名义价值

  if (grid.side === 'Buy') {
    const afterFill = state.positionNotional + orderNotional;
    if (afterFill > CONFIG.maxPosition) {
      warnPositionLimit('Buy', grid.id, state.positionNotional, afterFill);
      return false;
    }
    // 回到安全区后，允许下次“再次进入超限”时报警
    runtime.posLimit.buyOver = false;
  }

  if (grid.side === 'Sell') {
    const afterFill = state.positionNotional - orderNotional;
    if (afterFill < -CONFIG.maxPosition) {
      warnPositionLimit('Sell', grid.id, state.positionNotional, afterFill);
      return false;
    }
    runtime.posLimit.sellOver = false;
  }

  // 4. 通过所有检查，可以触发
  logInfo('✨ 触发网格 #' + grid.id + ' ' + grid.side + ' @ ' + grid.price.toFixed(4) + ' (距离 ' + distancePct + '%)');
  return true;
}

function placeOrder(grid) {
  // 双保险：避免重复挂单（grid 状态丢失时常见）
  const existing = findActiveOrderByGridId(grid.id);
  if (existing) {
    syncGridFromOrder(grid, existing);
    return;
  }

  grid.state = 'PLACING';
  grid.attempts++;
  grid.lastTriggerTime = Date.now();
  grid.lastTriggerPrice = state.lastPrice;

  let orderPrice = grid.price;
  if (grid.side === 'Buy') {
    orderPrice = grid.price * (1 - CONFIG.priceOffset);
  } else {
    orderPrice = grid.price * (1 + CONFIG.priceOffset);
  }

  // postOnly 保护
  const priceTick = 0.001;
  if (CONFIG.postOnly) {
    if (grid.side === 'Buy' && orderPrice >= state.lastPrice) {
      orderPrice = state.lastPrice - priceTick;
    } else if (grid.side === 'Sell' && orderPrice <= state.lastPrice) {
      orderPrice = state.lastPrice + priceTick;
    }
  }

  const quantity = CONFIG.orderSize / orderPrice;
  const orderLinkId = 'gales-' + grid.id + '-' + grid.side;

  logInfo((CONFIG.simMode ? '[SIM] ' : '') + '挂单 gridId=' + grid.id + ' ' + grid.side + ' ' + quantity.toFixed(4) + ' @ ' + orderPrice.toFixed(4));

  if (CONFIG.simMode) {
    const orderId = 'sim-' + grid.id + '-' + Date.now();

    const order = {
      orderId: orderId,
      orderLinkId: orderLinkId,
      gridId: grid.id,
      side: grid.side,
      price: orderPrice,
      qty: quantity,
      status: 'New',
      cumQty: 0,
      avgPrice: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    state.openOrders.push(order);

    grid.state = 'ACTIVE';
    grid.orderId = orderId;
    grid.orderLinkId = orderLinkId;
    grid.orderPrice = orderPrice;
    grid.orderQty = quantity;
    grid.cumQty = 0;
    grid.avgFillPrice = 0;
    grid.createdAt = order.createdAt;

    saveState();
    return;
  }

  // TODO: 真实下单（通过 bridge_placeOrder）
  try {
    const params = {
      symbol: CONFIG.symbol,
      side: grid.side,
      qty: quantity,
      price: orderPrice,
      orderLinkId: orderLinkId,
    };

    const result = bridge_placeOrder(JSON.stringify(params));
    const order = JSON.parse(result);

    grid.state = 'ACTIVE';
    grid.orderId = order.orderId;
    grid.orderLinkId = orderLinkId;
    grid.orderPrice = orderPrice;
    grid.orderQty = quantity;
    grid.cumQty = 0;
    grid.avgFillPrice = 0;
    grid.createdAt = Date.now();

    // 记录到 openOrders（后续由 st_onOrderUpdate 更新状态）
    state.openOrders.push({
      orderId: grid.orderId,
      orderLinkId: orderLinkId,
      gridId: grid.id,
      side: grid.side,
      price: orderPrice,
      qty: quantity,
      status: 'New',
      cumQty: 0,
      avgPrice: 0,
      createdAt: grid.createdAt,
      updatedAt: grid.createdAt,
    });

    logInfo('✅ 挂单成功 orderId=' + grid.orderId);
    saveState();
  } catch (e) {
    logWarn('❌ 挂单失败: ' + e);
    grid.state = 'IDLE';
  }
}

function cancelOrder(grid) {
  if (!grid.orderId) return;

  const orderId = grid.orderId;

  grid.state = 'CANCELING';

  if (CONFIG.simMode) {
    // 标记订单取消
    const o = getOpenOrder(orderId);
    if (o) {
      o.status = 'Canceled';
      o.updatedAt = Date.now();
    }
    removeOpenOrder(orderId);

    grid.state = 'IDLE';
    grid.orderId = undefined;
    grid.orderLinkId = undefined;
    grid.orderPrice = undefined;
    saveState();
    return;
  }

  // TODO: 真实撤单（通过 bridge_cancelOrder）
  try {
    bridge_cancelOrder(orderId);
    logInfo('✅ 取消订单成功 orderId=' + orderId);

    removeOpenOrder(orderId);

    grid.state = 'IDLE';
    grid.orderId = undefined;
    grid.orderLinkId = undefined;
    grid.orderPrice = undefined;
    saveState();
  } catch (e) {
    logWarn('❌ 取消订单失败: ' + e);
    grid.state = 'IDLE';
  }
}
