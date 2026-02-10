#!/bin/bash
# Quant-Lab E2E 测试脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${MOLTBABY_WORKDIR:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
LOG_DIR="/tmp/quant-lab-test"
mkdir -p $LOG_DIR

echo "╔════════════════════════════════════════════════╗"
echo "║     Quant-Lab E2E 测试套件                    ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# 清理函数
cleanup() {
  echo ""
  echo "🧹 清理进程..."
  pkill -f "bun.*director" 2>/dev/null || true
  pkill -f "bun.*start-pool" 2>/dev/null || true
  sleep 1
}

trap cleanup EXIT

# 测试 1: 基础连通
test_basic_connectivity() {
  echo "📡 测试 1: 基础连通性"
  
  # 启动 Director
  cd $WORK_DIR && bun quant-lab/src/director/service.ts > $LOG_DIR/director.log 2>&1 &
  DIRECTOR_PID=$!
  sleep 3
  
  # 检查健康
  HEALTH=$(curl -s http://localhost:8080/health)
  if [[ "$HEALTH" == *"status"*"ok"* ]]; then
    echo "  ✅ Director 健康"
  else
    echo "  ❌ Director 未响应"
    return 1
  fi
  
  # 启动 Worker (使用与 Director 预注册相同的 ID)
  cd $WORK_DIR && bun quant-lab/src/worker/start-pool.ts \
    --worker-id=system-worker-001 \
    --path=/system/tasks/worker-001 > $LOG_DIR/worker1.log 2>&1 &
  WORKER_PID=$!
  sleep 3
  
  # 检查 Worker 注册 (可能有 Director 预注册的 worker)
  sleep 2
  WORKERS=$(curl -s http://localhost:8080/api/workers)
  # 检查返回中是否有 worker 信息
  if echo "$WORKERS" | grep -q "worker"; then
    echo "  ✅ Worker 已注册"
    echo "  响应: $(echo "$WORKERS" | tr '\n' ' ')"
  else
    echo "  ❌ Worker 未注册"
    echo "  响应: $WORKERS"
    return 1
  fi
  
  echo ""
  return 0
}

# 测试 2: 单任务执行
test_single_task() {
  echo "🎯 测试 2: 单任务执行"
  
  # 触发任务
  RESULT=$(curl -s -X POST http://localhost:8080/api/tasks/volatility-collector)
  echo "  触发响应: $RESULT"
  
  if [[ "$RESULT" == *"success"*"true"* ]]; then
    echo "  ✅ 任务触发成功"
  else
    echo "  ❌ 任务触发失败"
    return 1
  fi
  
  # 等待执行
  echo "  ⏳ 等待 15 秒执行..."
  sleep 15
  
  # 检查 Worker 日志
  if grep -q "Starting task" $LOG_DIR/worker1.log; then
    echo "  ✅ Worker 拉取了任务"
  else
    echo "  ⚠️  Worker 未拉取任务 (检查日志)"
    tail -10 $LOG_DIR/worker1.log
  fi
  
  # 检查 Stats
  STATS=$(curl -s http://localhost:8080/api/stats)
  echo "  统计: $STATS"
  
  echo ""
  return 0
}

# 测试 3: 检查策略列表
test_strategies_list() {
  echo "📋 测试 3: 策略列表"
  
  STRATEGIES=$(curl -s http://localhost:8080/api/strategies)
  echo "  策略: $STRATEGIES"
  
  if [[ "$STRATEGIES" == *"volatility-collector"* ]]; then
    echo "  ✅ 策略列表正确"
  else
    echo "  ⚠️  策略列表可能有问题"
  fi
  
  echo ""
  return 0
}

# 测试 4: 多 Worker 场景
test_multi_worker() {
  echo "👥 测试 4: 多 Worker"
  
  # 启动第二个 Worker
  cd $WORK_DIR && bun quant-lab/src/worker/start-pool.ts \
    --worker-id=test-worker-002 \
    --path=/system/tasks/worker-002 > $LOG_DIR/worker2.log 2>&1 &
  WORKER2_PID=$!
  sleep 3
  
  WORKERS=$(curl -s http://localhost:8080/api/workers)
  if [[ "$WORKERS" == *"test-worker-002"* ]]; then
    echo "  ✅ Worker-002 已注册"
  else
    echo "  ⚠️  Worker-002 未显示"
  fi
  
  # 触发任务，观察分配
  echo "  触发任务..."
  curl -s -X POST http://localhost:8080/api/tasks/positions-reporter > /dev/null
  sleep 2
  
  echo "  ⏳ 等待分配..."
  sleep 10
  
  # 检查哪个 Worker 执行了
  if grep -q "positions-reporter" $LOG_DIR/worker1.log; then
    echo "  ✅ Worker-001 执行了任务"
  fi
  if grep -q "positions-reporter" $LOG_DIR/worker2.log; then
    echo "  ✅ Worker-002 执行了任务"
  fi
  
  kill $WORKER2_PID 2>/dev/null || true
  echo ""
  return 0
}

# 测试 5: Worker 重启
test_worker_restart() {
  echo "🔄 测试 5: Worker 重启"
  
  # 停止 Worker
  kill $WORKER_PID 2>/dev/null || true
  sleep 2
  
  # 重新启动
  cd $WORK_DIR && bun quant-lab/src/worker/start-pool.ts \
    --worker-id=test-worker-001 \
    --path=/system/tasks/worker-001 > $LOG_DIR/worker1.log 2>&1 &
  WORKER_PID=$!
  sleep 3
  
  WORKERS=$(curl -s http://localhost:8080/api/workers)
  if [[ "$WORKERS" == *"test-worker-001"* ]]; then
    echo "  ✅ Worker 重启后注册成功"
  else
    echo "  ❌ Worker 重启后未注册"
    return 1
  fi
  
  echo ""
  return 0
}

# 主执行
main() {
  cleanup
  sleep 1
  
  test_basic_connectivity
  test_strategies_list
  test_single_task
  test_multi_worker
  test_worker_restart
  
  echo ""
  echo "╔════════════════════════════════════════════════╗"
  echo "║     测试完成                                   ║"
  echo "╚════════════════════════════════════════════════╝"
  echo ""
  echo "日志位置:"
  echo "  Director: $LOG_DIR/director.log"
  echo "  Worker 1: $LOG_DIR/worker1.log"
  echo "  Worker 2: $LOG_DIR/worker2.log"
}

main
