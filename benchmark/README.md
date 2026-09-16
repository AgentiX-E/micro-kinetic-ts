# @agentix-e/micro-kinetic

> **将 2026 年菲尔兹奖得主邓煜的动理学理论（Kinetic Theory）应用于微服务根因分析**

[![pnpm](https://img.shields.io/badge/pnpm-9.x-blue)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/test-vitest-brightgreen)](https://vitest.dev)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 概述

Micro-Kinetic 是一个 **7 包 pnpm monorepo**，将邓煜（Yu Deng）在 2026 年国际数学家大会上获得菲尔兹奖的动理学理论——从牛顿方程严格推导玻尔兹曼方程的数学工具——**精确映射到微服务系统的根因分析（RCA）、告警降噪和故障传播建模**。

这不仅是另一个 AIOps 工具。这是**第一次有人尝试从第一性原理出发**，用数学严格的动理学方程来建模微服务集群的行为。

### 为什么是"动理学"？

邓煜的核心突破：

> **"证明了从微观粒子相互作用的牛顿方程，可以严格导出描述宏观气体行为的玻尔兹曼方程——解决了希尔伯特 125 年前提出的第六问题。"**

这一成果的本质是建立了**微观 ↔ 宏观的数学桥梁**。而微服务 RCA 正是在做同样的事：从单个服务调用（微观）推导全局系统故障（宏观）。

---

## 六个理论映射

| 邓煜的数学工具 | Micro-Kinetic 包 | 工程价值 |
|:---|:---|:---|
| **碰撞树 (Collision Tree)** | `@agentix-e/micro-kinetic-tree` | NP-hard 全图 RCA → 树上多项式可解 |
| **切割算法 (Cutting Algorithm)** | `@agentix-e/micro-kinetic-cutting` | 内存泄漏/连接池耗尽等慢性劣化严格检测 |
| **Stosszahlansatz** | `@agentix-e/micro-kinetic-noise` | 有数学依据的降噪阈值，非经验魔法常量 |
| **BBGKY Hierarchy** | `@agentix-e/micro-kinetic-scaling` | 多服务关联分析的复杂度控制 |
| **Boltzmann-Grad 极限** | `@agentix-e/micro-kinetic-scaling` | 故障概率 P_fault(N) 的渐近估计 |
| **波动理学方程 (WKE)** | `@agentix-e/micro-kinetic-wave` | 告警传播速度/衰减/预测 |

---

## 安装

```bash
# 安装核心 RCA 引擎
pnpm add @agentix-e/micro-kinetic-tree numpy-ts

# 安装告警降噪引擎
pnpm add @agentix-e/micro-kinetic-noise numpy-ts decimal.js simple-statistics

# 安装完整套件（含 CLI）
pnpm add @agentix-e/micro-kinetic numpy-ts
```

---

## 快速开始

### 5 分钟：对微服务集群运行 RCA

```typescript
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { registerTreeModule } from '@agentix-e/micro-kinetic-tree';

// 1. 创建 DI 容器并注册引擎
const container = new Container();
registerTreeModule(container);

// 2. 构建服务调用图
const callGraph = {
  nodes: new Map([
    ['gw', { id: 'gw', name: 'api-gateway', namespace: 'prod' }],
    ['svc-a', { id: 'svc-a', name: 'orders', namespace: 'prod' }],
    ['svc-b', { id: 'svc-b', name: 'payments', namespace: 'prod' }],
    ['db', { id: 'db', name: 'postgres', namespace: 'prod' }],
  ]),
  edges: [
    { from: 'gw', to: 'svc-a', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0 },
    { from: 'gw', to: 'svc-b', type: 'REST', callRate: 80, p99Latency: 15, errorRate: 0 },
    { from: 'svc-a', to: 'db', type: 'gRPC', callRate: 200, p99Latency: 5, errorRate: 0.01 },
    { from: 'svc-b', to: 'db', type: 'gRPC', callRate: 150, p99Latency: 3, errorRate: 0.02 },
  ],
  systemLoad: 0.6,
};

// 3. 提供指标数据
const metrics = new Map();
const times = [0, 60000, 120000, 180000, 240000, 300000];
metrics.set('db', [{
  label: 'cpu', timestamps: times,
  values: new Float64Array([20, 45, 65, 82, 93, 97]),
  unit: '%'
}]);

// 4. 运行 RCA
const engine = container.resolve(DI_TOKENS.RCA_ENGINE);
const faultGraph = engine.buildFaultGraph(callGraph, metrics);
const results = await engine.analyze(faultGraph, 3);

// 5. 查看根因结果
for (const r of results) {
  console.log(`#${r.rank} ${r.serviceId} — ${r.faultType.category} — confidence: ${(r.confidence * 100).toFixed(1)}%`);
}
```

### CLI 使用

```bash
# 分析服务图
aiops-kinetic analyze graph.json metrics.json --topK 5

# 告警降噪
aiops-kinetic denoise alerts.json

# 运行 benchmark
aiops-kinetic benchmark --dataset rcaeval-re1
```

---

## 包结构

```
@agentix-e/micro-kinetic/
├── packages/
│   ├── core/        → @agentix-e/micro-kinetic-core       (零依赖契约层)
│   ├── tree/        → @agentix-e/micro-kinetic-tree       (碰撞树 RCA 引擎)
│   ├── cutting/     → @agentix-e/micro-kinetic-cutting    (切割算法慢性故障)
│   ├── noise/       → @agentix-e/micro-kinetic-noise      (Stosszahlansatz 告警降噪)
│   ├── scaling/     → @agentix-e/micro-kinetic-scaling    (BBGKY + Boltzmann-Grad)
│   ├── wave/        → @agentix-e/micro-kinetic-wave       (波动理学告警传播)
│   └── kinetic/     → @agentix-e/micro-kinetic            (伞包 + CLI + Pipeline)
```

---

## 测试覆盖

| 包 | 测试文件 | 测试数 | 通过 |
|----|---------|--------|------|
| core | 21 | 285 | ✅ |
| tree | 8 | 154 | ✅ |
| cutting | 9 | 123 | ✅ |
| noise | 7 | 139 | ✅ |
| scaling | 5 | 161 | ✅ |
| wave | 5 | 117 | ✅ |
| **总计** | **55** | **979** | **✅** |

---

## 文档

- [架构设计](./ARCHITECTURE.md) — 高层架构和设计决策
- [用户指南](./USER_GUIDE.md) — 详细使用指南和场景示例
- [贡献指南](./CONTRIBUTING.md) — 如何贡献代码

---

## 依赖选型

| 依赖 | 用途 | 选择理由 |
|------|------|---------|
| `numpy-ts` | 默认数学后端 | 94% NumPy API，1.25× 快于 Python NumPy |
| `ubique` | WASM 线性代数 | Rust nalgebra，det 快 26× |
| `decimal.js` | 任意精度计算 | 独立分解误差避免浮点漂移 |
| `simple-statistics` | 统计分析 | 零依赖纯 JS，全统计方法 |

---

## 许可

MIT © AgentiX-E
