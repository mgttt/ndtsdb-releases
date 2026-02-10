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
  
  magnetDistance: 0.002,
  cancelDistance: 0.005,
  priceOffset: 0.0005,
  postOnly: true,
  
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
function st_heartbeat(tick) {
  if (!tick || !tick.price) return;
  
  state.lastPrice = tick.price;
  
  // 首次初始化网格
  if (!state.initialized) {
    state.centerPrice = tick.price;
    initializeGrids();
    state.initialized = true;
    logInfo('网格初始化完成，中心价格: ' + state.centerPrice);
    saveState();
    return;
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
    });
  }
  
  logInfo('生成网格: ' + state.gridLevels.length + ' 个档位');
}

function shouldPlaceOrder(grid, distance) {
  if (distance > CONFIG.magnetDistance) return false;
  if (grid.side === 'Buy' && state.lastPrice < grid.price) return false;
  if (grid.side === 'Sell' && state.lastPrice > grid.price) return false;
  if (grid.side === 'Buy' && state.positionNotional >= CONFIG.maxPosition) return false;
  if (grid.side === 'Sell' && state.positionNotional <= -CONFIG.maxPosition) return false;
  return true;
}

function placeOrder(grid) {
  grid.state = 'PLACING';
  grid.attempts++;
  
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
  
  logInfo((CONFIG.simMode ? '[SIM] ' : '') + '挂单 gridId=' + grid.id + ' ' + grid.side + ' ' + quantity.toFixed(4) + ' @ ' + orderPrice);
  
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
