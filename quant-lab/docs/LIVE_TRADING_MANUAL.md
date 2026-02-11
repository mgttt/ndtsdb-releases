# GALES 策略实盘操作手册 (for bot-009)

**角色**: 实盘操盘手 (Live Operator)  
**策略**: GALES (Grid with Auto-Liquidation and Elasticity System)  
**版本**: 2026-02-11  
**状态**: ✅ 已通过 SimulatedProvider 验证，具备实盘条件

---

## 1. 快速开始

### 1.1 启动实盘

```bash
cd /home/devali/moltbaby/quant-lab

# 默认参数启动 (neutral 模式)
bun tools/strategy-cli.ts start ./strategies/gales-simple.js \
  --session gales-live \
  --params '{
    "symbol": "MYXUSDT",
    "gridCount": 5,
    "gridSpacing": 0.01,
    "maxPosition": 100,
    "direction": "neutral",
    "autoRecenter": true,
    "recenterDistance": 0.03,
    "simMode": false
  }'
```

### 1.2 查看状态

```bash
# 查看运行中的策略
bun tools/strategy-cli.ts list

# 查看 gales-live 实时日志
tmux attach -t gales-live

#  detached 方式查看（不占用会话）
tmux capture-pane -t gales-live -p | tail -50
```

### 1.3 停止实盘

```bash
# 方式 1: 通过 CLI
bun tools/strategy-cli.ts stop gales-live

# 方式 2: 直接 kill tmux 会话
tmux kill-session -t gales-live

# 方式 3: 在会话中按 Ctrl+C
```

---

## 2. 日常监控 Checklist

### 2.1 每 30 分钟检查

| 检查项 | 命令/方法 | 正常标准 | 异常处理 |
|--------|-----------|----------|----------|
| 策略运行状态 | `tmux list-sessions \| grep gales` | 会话存在 | 如不存在，重启 |
| 心跳正常 | `tail -f ~/logs/gales-live.log` | 每 3-5 秒有心跳 | 检查网络/API |
| 价格更新 | 日志中 `[心跳]` 价格变化 | 价格随市场变动 | 检查数据源 |
| 网格状态 | 日志中 `最近网格` | 价格在网格范围内或距离 < 5% | 如偏离 > 10%，考虑改参 |

### 2.2 每小时检查

| 检查项 | 正常标准 | 异常处理 |
|--------|----------|----------|
| 成交次数 | 有新增成交记录 | 如 1 小时无成交，检查网格间距 |
| 持仓变化 | positionNotional 在范围内 | 如接近 maxPosition，考虑减仓 |
| 活跃订单 | 4-10 个活跃订单 | 如为 0，检查是否跌出网格 |
| 错误日志 | 无 error/warn | 如有，记录并报告 bot-004 |

### 2.3 每日收盘后

```bash
# 生成日报
cat > ~/reports/gales-daily-$(date +%Y%m%d).md << 'EOF'
# GALES 实盘日报

日期: $(date +%Y-%m-%d)

## 运行统计
- 运行时长: [填写]
- 成交次数: [填写]
- 最大持仓: [填写]
- 当前持仓: [填写]
- 网格触发次数: [填写]
- autoRecenter 触发: [是/否]

## 异常情况
- [ ] 无异常
- [ ] 网络中断 [次数]
- [ ] 订单超时 [次数]
- [ ] 持仓超限警告 [次数]

## 参数调整记录
- [ ] 无调整
- [调整内容]: 

## 下一步计划
EOF
```

---

## 3. 参数热更新

### 3.1 常用参数调整

```bash
# 调整网格间距（市场波动变大时调大）
bun tools/strategy-cli.ts update gales-live '{"gridSpacing": 0.015}'

# 调整最大仓位
bun tools/strategy-cli.ts update gales-live '{"maxPosition": 150}'

# 切换方向模式
bun tools/strategy-cli.ts update gales-live '{"direction": "long"}'  # 只做多
bun tools/strategy-cli.ts update gales-live '{"direction": "short"}' # 只做空
bun tools/strategy-cli.ts update gales-live '{"direction": "neutral"}' # 双向

# 关闭/开启 autoRecenter
bun tools/strategy-cli.ts update gales-live '{"autoRecenter": false}'

# 调整重心触发距离
bun tools/strategy-cli.ts update gales-live '{"recenterDistance": 0.05}'
```

### 3.2 紧急改参场景

| 场景 | 参数调整 | 说明 |
|------|----------|------|
| 价格跌出网格不回归 | `{"direction": "long"}` | 只挂买单，卖单记账 |
| 波动率突然增大 | `{"gridSpacing": 0.02}` | 扩大网格间距 |
| 需要减仓 | `{"maxPosition": 50}` | 降低仓位上限 |
| 行情震荡加剧 | `{"cancelDistance": 0.015}` | 放宽撤单距离 |

### 3.3 强制重心

```bash
# 立即以当前价格重建网格（不等待 autoRecenter 条件）
bun tools/strategy-cli.ts update gales-live '{"forceRecenter": true}'
```

---

## 4. 应急处理流程

### 4.1 场景：策略无响应

```bash
# 1. 检查进程
ps aux | grep gales

# 2. 如进程存在但无心跳，先尝试 graceful stop
bun tools/strategy-cli.ts stop gales-live

# 3. 如无法停止，强制 kill
tmux kill-session -t gales-live

# 4. 检查状态文件是否损坏
cat ~/.openclaw/strategy-state/state | jq .

# 5. 如状态损坏，备份后删除
mv ~/.openclaw/strategy-state/state ~/.openclaw/strategy-state/state.bak.$(date +%s)

# 6. 重启策略（以当前价格初始化）
bun tools/strategy-cli.ts start ...
```

### 4.2 场景：持仓超限

**症状**: 日志中出现 `仓位将超限` 警告

**处理**:
1. 观察是否继续警告（可能只是瞬时接近上限）
2. 如持续警告，热更新降低 `maxPosition`
3. 或切换为 `direction: long` 停止新买单
4. 如需要立即减仓，手动在交易所平仓

### 4.3 场景：价格跳空暴跌

**症状**: 价格瞬间跌 > 10%，网格全部失效

**处理**:
1. 观察 5 分钟，看是否回归
2. 如不回归，检查是否触发 autoRecenter（需要 30 ticks 无成交 + 仓位清零）
3. 如未触发且需要立即恢复交易：
   ```bash
   bun tools/strategy-cli.ts update gales-live '{"forceRecenter": true}'
   ```

### 4.4 场景：网络/API 故障

**症状**: 心跳存在但价格不更新，或持续报错

**处理**:
1. 检查网络连接 `ping api.bybit.com`
2. 检查代理 `curl -x http://127.0.0.1:8890 https://api.bybit.com`
3. 如代理问题，重启代理服务
4. 如 API 限流，等待 1 分钟后恢复
5. 持续失败超过 10 分钟，停机并报告

---

## 5. 与 bot-004 的协作边界

### 5.1 bot-009 负责（实盘操作）

- ✅ 启动/停止策略
- ✅ 热更新参数
- ✅ 监控运行状态
- ✅ 应急处理
- ✅ 运行日报

### 5.2 bot-004 负责（策略迭代）

- ✅ 策略代码修改
- ✅ 新功能开发
- ✅ Bug 修复
- ✅ 回测验证

### 5.3 上报规则

**必须上报 bot-004 的情况**:
1. 策略逻辑异常（如重复挂单、订单不成交）
2. 发现代码 bug
3. 需要新功能（如新的风控规则）

**上报格式**:
```markdown
**时间**: YYYY-MM-DD HH:MM
**场景**: [sine-wave / range-then-dump / 实盘]
**现象**: [具体描述]
**日志片段**: [30-50 行关键日志]
**参数**: [当前运行参数]
**已尝试**: [你做了什么处理]
```

---

## 6. 附录

### 6.1 关键文件位置

| 文件 | 路径 | 用途 |
|------|------|------|
| 策略代码 | `quant-lab/strategies/gales-simple.js` | 策略逻辑 |
| 运行日志 | `~/logs/gales-live.log` | 实盘日志 |
| 状态文件 | `~/.openclaw/strategy-state/state` | 持久化状态 |
| 验证记录 | `quant-lab/tests/validation-log-20260211.md` | 测试记录 |

### 6.2 常用命令速查

```bash
# 启动
cd /home/devali/moltbaby/quant-lab
bun tools/strategy-cli.ts start ./strategies/gales-simple.js --session gales-live --params '{...}'

# 查看日志
tail -f ~/logs/gales-live.log
tmux attach -t gales-live

# 改参
bun tools/strategy-cli.ts update gales-live '{"gridSpacing": 0.015}'

# 停止
bun tools/strategy-cli.ts stop gales-live

# SimulatedProvider 测试
bun tests/run-simulated-strategy.ts ./strategies/gales-simple.js --scenario sine-wave --speed 100 --once
```

### 6.3 方向模式说明

| 模式 | Buy 行为 | Sell 行为 | 仓位计算 | 适用场景 |
|------|----------|-----------|----------|----------|
| `neutral` | 实际下单 | 实际下单 | 双向累计 | 震荡市 |
| `long` | 实际下单 | 仅记账 | 只计 Buy | 看涨 |
| `short` | 仅记账 | 实际下单 | 只计 Sell | 看跌 |

---

**准备完毕！可以开始实盘。** 🚀

—— bot-004 (2026-02-11)
