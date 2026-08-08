# RCAEval Benchmark Regression Fix Plan

Created: 2026-08-08 09:30 CST

## 问题总览

### P0: RE1 Ablation 全部 0%（回归！）
- 所有 10 configs × 3 reps：A@1=0%, A@5=0%, LA=0%, TA=25.7%
- 但 full benchmark RE1 中 OnlineBoutique=60%, SockShop=58.4%
- **Ablation 和 full benchmark 使用同一个runner，为什么不一致？**

### P0: TrainTicket RE1 0%（未修复）
- Full benchmark: 0% across all fault types
- 归一化阈值≥20 nodes 已触发，但 totalScore 计算 bug 导致祖先节点淹没根因

### P0: RE2 仍然 OOM
- ablation RE2 也 OOM（6040MB heap → 6144MB 不够）
- loadSingleCase 优化不足以解决 270 cases × complex traces

### P1: RE3 0%
- 剪枝修复后边保留正确（24→24, 267→267）
- 但 RCA 引擎输出全部 0%
- Per-fault: f2=100%, f4=100%, f1=0%, f3=40%, f5=0%

### P2: Synthetic Benchmark 数据为空
- Metric 列无值

## 调查计划

### Phase 1: Root Cause — RE1 Ablation vs Full Benchmark 差异
1. 对比 ablation runner 和 full benchmark runner 的代码路径
2. 检查 ablation 的 result calculation 逻辑
3. 检查 ablation 中 per-suite 的 case distribution（125+125+125=375 合并为 re1）

### Phase 2: TrainTicket RCA 引擎修复
1. 分析 totalScore = nodeAnomaly + childContrib 在大拓扑中的行为
2. 设计 childContrib 权重校正机制
3. 添加大拓扑测试

### Phase 3: RE2 OOM 根治
1. 分析 ablation RE2 的 memory profile
2. 实现真正的流式/分批加载
3. 从 RCAEvalJSON 缓存中按需加载

### Phase 4: RE3 修复
1. 分析 per-fault-type: f2/f4=100% 为何可以但其他不行
2. 对比 RE1 vs RE3 的 case 结构差异

### Phase 5: Synthetic 基准修复
1. 检查 run-all.ts 输出格式

## 验收标准
- pnpm test: 0 failures, ≥95% coverage
- pnpm typecheck: pass
- pnpm format:check: pass
- 通过 benchmark dashboard 验证
