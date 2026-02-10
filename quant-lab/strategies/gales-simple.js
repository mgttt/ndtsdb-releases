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
};

// 加载状态
function loadState() {
  try {
    const saved = bridge_stateGet('state', 'null');
    if (saved && saved !== 'null') {
      const obj = JSON.parse(saved);
      if (obj && typeof obj === 'object') {
        state = obj;
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

function logWarn(msg) {
  bridge_log('warn', '[Gales] ' + msg);
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
  
  // 检查网格
  for (let i = 0; i < state.gridLevels.length; i++) {
    const grid = state.gridLevels[i];
    const distance = Math.abs(state.lastPrice - grid.price) / grid.price;
    
    if (grid.state === 'IDLE') {
      if (shouldPlaceOrder(grid, distance)) {
        placeOrder(grid);
      }
    } else if (grid.state === 'ACTIVE') {
      if (distance > CONFIG.cancelDistance) {
        logInfo('价格偏离，取消订单 gridId=' + grid.id);
        cancelOrder(grid);
      }
    }
  }
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
  
  // 3. 仓位检查
  if (grid.side === 'Buy' && state.positionNotional >= CONFIG.maxPosition) {
    logWarn('买单 #' + grid.id + ' 仓位已达上限');
    return false;
  }
  
  if (grid.side === 'Sell' && state.positionNotional <= -CONFIG.maxPosition) {
    logWarn('卖单 #' + grid.id + ' 仓位已达下限');
    return false;
  }
  
  // 4. 通过所有检查，可以触发
  logInfo('✨ 触发网格 #' + grid.id + ' ' + grid.side + ' @ ' + grid.price.toFixed(4) + ' (距离 ' + distancePct + '%)');
  return true;
}

function placeOrder(grid) {
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
    grid.state = 'ACTIVE';
    grid.orderId = 'sim-' + grid.id;
    grid.orderLinkId = orderLinkId;
    grid.orderPrice = orderPrice;
    grid.createdAt = Date.now();
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
    grid.createdAt = Date.now();
    
    logInfo('✅ 挂单成功 orderId=' + grid.orderId);
    saveState();
  } catch (e) {
    logWarn('❌ 挂单失败: ' + e);
    grid.state = 'IDLE';
  }
}

function cancelOrder(grid) {
  if (!grid.orderId) return;
  
  grid.state = 'CANCELING';
  
  if (CONFIG.simMode) {
    grid.state = 'IDLE';
    grid.orderId = undefined;
    grid.orderLinkId = undefined;
    grid.orderPrice = undefined;
    saveState();
    return;
  }
  
  // TODO: 真实撤单（通过 bridge_cancelOrder）
  try {
    bridge_cancelOrder(grid.orderId);
    logInfo('✅ 取消订单成功 orderId=' + grid.orderId);
    
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
