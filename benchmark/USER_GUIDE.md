# 用户指南

> @agentix-e/micro-kinetic — 从零开始的微服务动理学 RCA

---

## 目录

1. [安装与配置](#1-安装与配置)
2. [核心概念](#2-核心概念)
3. [场景一：急性故障 RCA](#3-场景一急性故障-rca)
4. [场景二：慢性故障检测](#4-场景二慢性故障检测)
5. [场景三：告警风暴降噪](#5-场景三告警风暴降噪)
6. [场景四：系统规模分析](#6-场景四系统规模分析)
7. [场景五：告警传播预测](#7-场景五告警传播预测)
8. [CLI 使用](#8-cli-使用)
9. [性能调优](#9-性能调优)
10. [常见问题](#10-常见问题)

---

## 1. 安装与配置

### 完整安装（含 CLI）

```bash
pnpm add @agentix-e/micro-kinetic numpy-ts
```

### 按需安装

```bash
# 仅 RCA
pnpm add @agentix-e/micro-kinetic-tree numpy-ts

# 仅告警降噪
pnpm add @agentix-e/micro-kinetic-noise numpy-ts decimal.js simple-statistics

# 仅规模分析
pnpm add @agentix-e/micro-kinetic-scaling numpy-ts ubique
```

### Node.js 版本要求

- Node.js ≥ 22.0.0
- 推荐 pnpm ≥ 9.0.0

---

## 2. 核心概念

### 2.1 服务调用图（ServiceCallGraph）

这是所有算法的输入端——表示微服务集群的拓扑：

```typescript
interface ServiceCallGraph {
  nodes: Map<string, ServiceNode>;  // 服务 ID → 节点
  edges: CallEdge[];                // 调用边列表
  systemLoad: number;               // 系统负载（归一化到 [0,1]）
}

interface CallEdge {
  from: string;           // 源服务
  to: string;             // 目标服务
  type: EdgeType;         // REST | gRPC | MQ | CALLBACK | ASYNC
  callRate: number;       // 调用频率（次/分钟）
  p99Latency: number;     // P99 延迟（毫秒）
  errorRate: number;      // 错误率 [0,1]
}
```

### 2.2 时间序列数据（TimeSeries）

```typescript
interface TimeSeries {
  label: string;                // 指标名（cpu, mem_rss, gc_pause 等）
  timestamps: number[];         // Unix 毫秒时间戳
  values: Float64Array;         // 指标值
  unit: string;                 // 单位（%, MB, ms 等）
}
```

### 2.3 根因分析结果（RootCauseResult）

```typescript
interface RootCauseResult {
  serviceId: string;                  // 根因服务
  faultType: FaultType;              // 故障分类
  confidence: number;                // 置信度 [0,1]
  rank: number;                      // Top-K 排名
  propagationDepth: number;          // 传播深度
  propagationErrorBound: number;     // 传播误差界
  viaTreeSearch: boolean;            // 是否通过树搜索
}
```

---

## 3. 场景一：急性故障 RCA

### 适用场景

- API 网关延迟尖峰
- 错误率突然上升
- 明确的异常时间点

### 示例代码

```typescript
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { registerTreeModule } from '@agentix-e/micro-kinetic-tree';

const container = new Container();
registerTreeModule(container);
const engine = container.resolve(DI_TOKENS.RCA_ENGINE);

// 构建服务调用图（省略构建细节，见 README 快速开始）
const callGraph = buildServiceCallGraph();
const metrics = collectMetrics();

// 运行 RCA
const faultGraph = engine.buildFaultGraph(callGraph, metrics);
const results = await engine.analyze(faultGraph, 5); // Top-5

// 处理结果
for (const r of results) {
  if (r.confidence > 0.8) {
    console.log(`根因: ${r.serviceId} (置信度: ${(r.confidence * 100).toFixed(1)}%)`);
    console.log(`  故障类型: ${r.faultType.category}/${r.faultType.subType}`);
    console.log(`  传播深度: ${r.propagationDepth} 跳`);
  }
}
```

### 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `pruneEpsilon` | 0.001 | 环贡献剪枝阈值 |
| `criticalLoadThreshold` | 0.7 | 临界负载阈值 |
| `defaultTopK` | 5 | Top-K 结果数 |
| `maxPropagationDepth` | 10 | 最大传播深度 |

---

## 4. 场景二：慢性故障检测

### 适用场景

- 内存泄漏（运行 72 小时后 OOM）
- 连接池缓慢耗尽
- 数据倾斜逐渐恶化
- 无明确异常时间点

### 示例代码

```typescript
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { registerCuttingFactories } from '@agentix-e/micro-kinetic-cutting';

const container = new Container();
registerCuttingFactories(container);
const engine = container.resolve(DI_TOKENS.CUTTING_ENGINE);

// 准备 72 小时时序数据
const memoryTS = prepare72HourTimeSeries();

// 自适应切割
const windows = engine.segment(memoryTS, {
  maxWindows: 24,            // 24 个短窗（每 3 小时一段）
  minWindowDurationMs: 3600000, // 最少 1 小时
  adaptive: true,            // 启用自适应切割
});

// 局部误差估计
const localBounds = engine.estimateLocalBounds(windows, 'mem_rss');

// 归纳证明收敛
const convergence = engine.proveConvergence(localBounds, 0.01);

if (convergence.converged) {
  console.log(`收敛时刻上界: ${new Date(convergence.convergenceTime!)}`);
  console.log(`总误差: ${convergence.totalError}`);
}
```

### 支持的慢性故障类型

| 类型 | 劣化模式 | 检测器 |
|------|---------|--------|
| 内存泄漏 | 线性增长 r = Δmem/Δt | `MemoryLeakDetector` |
| 连接池耗尽 | 指数型饱和 | `ConnectionPoolDetector` |
| 数据倾斜 | 幂律分布集中 | `DegradationCurveAnalyzer` |
| 渐进退化 | 对数型 | `PatternClassifier` |

---

## 5. 场景三：告警风暴降噪

### 适用场景

- 一次故障触发数百条告警
- 告警疲劳 → SRE 忽略真正的根因

### 核心概念：Stosszahlansatz 判据

```
条件 1: N ≥ 20（系统规模足够大）
条件 2: S > 0.7（服务间耦合足够稀疏，S = 1 - ||C||₀/N²）
结论:   大多数同时告警是巧合 → 可安全降噪
误差界: sup|P(AB) - P(A)P(B)| ≤ K/N
```

### 示例代码

```typescript
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { registerNoiseFactories } from '@agentix-e/micro-kinetic-noise';

const container = new Container();
registerNoiseFactories(container);
const engine = container.resolve(DI_TOKENS.DENOISE_ENGINE);

// 计算耦合稀疏度
const coupling = engine.computeCouplingSparsity(alertHistory, callGraph);
console.log(`耦合稀疏度: ${coupling.sparsityScore.toFixed(3)}`);
console.log(`满足 Stosszahlansatz: ${coupling.satisfiesStosszahlansatz}`);

// 降噪
const result = engine.denoise(allAlerts, coupling);

console.log(`真告警: ${result.trueAlarms.length}`);
console.log(`巧合告警（可降噪）: ${result.coincidentalAlarms.length}`);
console.log(`分组告警: ${result.groupedAlarms.length}`);
console.log(`假阳性降低率: ${(result.falsePositiveReduction * 100).toFixed(1)}%`);
```

### 预期效果

| 系统规模 N | 预期降噪率 | 误判风险 |
|-----------|-----------|---------|
| N < 10 | 10-20% | 高（不建议） |
| 10 ≤ N < 50 | 30-50% | 中 |
| N ≥ 50 | 50-80% | 低（K/N → 0） |

---

## 6. 场景四：系统规模分析

### 适用场景

- 微服务从 10 → 100 → 1000 个迁移
- 预测规模增长对故障概率的影响
- 验证熔断/限流策略是否足够

### 核心概念：Boltzmann-Grad 极限

```
N → ∞（服务数量增长）
d → 0（故障影响半径缩小）
Nd² = 常数（全局故障密度不变）

违反此约束 → 级联故障必然发生
```

### 示例代码

```typescript
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { registerScalingFactories } from '@agentix-e/micro-kinetic-scaling';

const container = new Container();
registerScalingFactories(container);
const analyzer = container.resolve(DI_TOKENS.SCALING_ANALYZER);

// 分析不同规模的故障概率
for (const N of [10, 50, 100, 500, 1000]) {
  const result = analyzer.estimateFaultProbability(N, 0.1 / Math.sqrt(N));
  console.log(`N=${N}: P_fault=${(result.faultProbabilityAsymptotic * 100).toFixed(1)}% (${result.regime} regime)`);
}
```

### Regime 判定

| Nd² | Regime | 含义 |
|------|--------|------|
| < 0.5 | dilute | 故障概率低，系统健康 |
| 0.5 - 1.5 | transition | 临界区，需要监控 |
| > 1.5 | dense | 高风险，级联故障概率上升 |

---

## 7. 场景五：告警传播预测

### 适用场景

- 预测一个服务故障后告警波的传播路径和速度
- 估计最佳响应窗口时间

### 核心概念：波动理学方程（WKE）

告警强度 I(s,t) 满足：
```
I(s,t+Δt) = I(s,t) + Δt × Σ T(s,s',s'')[I(s')I(s'') - I(s)(I(s')+I(s''))] - γ × I(s,t)
```

关联衰减满足：
```
C(t) = C₀ × exp(-t/τ)，其中 τ = 1/spectralGap
```

### 示例代码

```typescript
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { registerWaveFactories } from '@agentix-e/micro-kinetic-wave';

const container = new Container();
registerWaveFactories(container);
const model = container.resolve(DI_TOKENS.WAVE_PROPAGATION_MODEL);

// 模拟从 db 服务发起的告警级联
const result = model.simulateCascade('db', callGraph, {
  couplingStrength: 0.5,
  propagationSpeed: 1.0,
  decayTimeConstant: 30000,   // 30 秒衰减
  cascadeThreshold: 0.3,
  timeHorizon: 60000,          // 模拟 60 秒
});

console.log(`传播距离: ${result.propagationDistance} 跳`);
console.log(`峰值强度: ${(result.peakIntensity * 100).toFixed(1)}%`);
console.log(`到达峰值时间: ${result.timeToPeak}ms`);

if (result.dissipated) {
  console.log(`耗散时间: ${result.dissipationTime}ms`);
}
```

---

## 8. CLI 使用

### 安装 CLI

```bash
pnpm add @agentix-e/micro-kinetic
```

### 命令

```bash
# 分析服务拓扑 + 指标数据
aiops-kinetic analyze graph.json metrics.json \
  --topK 5 \
  --pruneEpsilon 0.001 \
  --output json

# 告警降噪
aiops-kinetic denoise alerts.json \
  --threshold 0.7 \
  --output table

# 运行 benchmark（需要提前下载数据集）
aiops-kinetic benchmark \
  --dataset rcaeval-re1 \
  --output report.json
```

### 输入格式

**graph.json**：
```json
{
  "nodes": {
    "svc-a": {"id": "svc-a", "name": "orders", "namespace": "prod"},
    "svc-b": {"id": "svc-b", "name": "payments", "namespace": "prod"}
  },
  "edges": [
    {"from": "svc-a", "to": "svc-b", "type": "gRPC", "callRate": 100, "p99Latency": 5, "errorRate": 0.01}
  ],
  "systemLoad": 0.6
}
```

**metrics.json**：
```json
{
  "svc-a": [{
    "label": "cpu",
    "timestamps": [0, 60000, 120000],
    "values": [30, 45, 80],
    "unit": "%"
  }]
}
```

---

## 9. 性能调优

### 数学后端选择

| 场景 | 推荐后端 | 理由 |
|------|---------|------|
| 通用 RCA | numpy-ts（默认） | 全面且快速 |
| 大规模矩阵运算 | ubique（WASM） | det 快 26× |
| 告警降噪精度敏感 | decimal.js | 50 位精度 |
| WASM 不可用 | ml-matrix（回退） | 纯 JS |

### 图规模建议

| 节点数 | 推荐配置 | 预期耗时 |
|--------|---------|---------|
| < 100 | 默认 | < 100ms |
| 100-500 | ε = 0.01 | < 1s |
| 500-1000 | ε = 0.05, maxDepth=5 | < 5s |
| > 1000 | 截断模式 | < 30s |

---

## 10. 常见问题

### Q: 我的服务调用图有 1000+ 个节点，RCA 太慢了

A: 增大 `pruneEpsilon`（如 0.01 → 0.05），减小 `maxPropagationDepth`（如 10 → 5），或对大规模图使用截断环枚举。

### Q: 告警降噪后漏掉了真正的根因

A: 检查 `couplingSparsity` 是否过高导致误判。降低 `threshold`（默认 0.7，可调至 0.5）。N < 10 时不建议使用 Stosszahlansatz。

### Q: chronic fault 检测没有发现内存泄漏

A: 检查时序数据是否有足够的单调性。如数据噪音较大，增大 `minWindowDurationMs`（如 3600000 → 7200000）来平滑。

### Q: 如何贡献代码？

A: 见 [CONTRIBUTING.md](./CONTRIBUTING.md)。遵循 PR → CI → review → merge 流程。
