# 架构设计

> @agentix-e/micro-kinetic — 将邓煜动理学理论映射到微服务 RCA 的数学-工程架构

---

## 1. 设计哲学

Micro-Kinetic 遵循四项核心原则：

### 1.1 数学严格性优先

每个算法的实现必须附带邓煜数学理论的原型引用和误差界。不接受启发式方法。

### 1.2 零依赖契约层（core 包）

`@agentix-e/micro-kinetic-core` **绝不引入任何外部 npm 依赖**。它只定义抽象接口和类型契约。所有具体实现下沉到子包。

### 1.3 DI 容器解耦

使用 AgentiX-E 生态统一的自定义 Symbol-based DI 容器：
- `Symbol.for('micro-kinetic:*')` 命名空间
- 运行时热替换数学后端（numpy-ts ↔ ubique ↔ ml-matrix）
- 15+ Token、42+ Factory 注册

### 1.4 渐进式精度

- 默认：numpy-ts（1.25× faster than NumPy，纯 TS+WASM）
- 高性能：ubique（Rust nalgebra WASM，26× faster det）
- 高精度：decimal.js（50 位有效数字）

---

## 2. 六大数学理论映射

### 2.1 碰撞树 → 故障传播树剪枝（tree 包）

**邓煜原型**：碰撞树展开将粒子碰撞历史表示为树，严格证明闭合环状碰撞在稀薄气体极限下总贡献 → 0。

**AIOps 映射**：

```
原始：粒子碰撞历史 = 树结构 → 环贡献 Σw(C) → 0（稀薄极限）
映射：服务调用图 = 故障传播图 → 环贡献 w(C)=∏p(e) → 0（低负载）
算法：Johnson 环检测 → w(C) < ε 剪枝 → 树上多项式 O(V+E) RCA
```

**核心算法**：
- `JohnsonCycleDetector`：O((V+E)×C) 全环检测
- `CollisionContributionAnalyzer`：w(C) = ∏_{e∈C} propagationWeight(e)
- `TreePruner`：w(C) < ε 环 → 剪断最弱边
- `TreeRCAEngine`：自底向上异常分数累积，Top-K 排序

**误差界**：传播深度 k 后的置信度 ε_k = 1 - α^k

### 2.2 切割算法 → 慢性故障分段归纳（cutting 包）

**邓煜原型**：长时演化区间 [0,T] → 切 N 段 → 每段局部能量估计 → 归纳证明全局 H 定理收敛。

**AIOps 映射**：

```
原始：[0,T] → 切 N 段 → 局部能量 → 全局收敛
映射：72h 时序 → 切 N 短窗 → ε_j 误差界 → 收敛时刻上界 T_conv
应用：内存泄漏/连接池耗尽/数据倾斜
```

**核心算法**：
- `AdaptiveWindowCutter`：ε_j = r_j × δ_j²/2（动理学能量估计）
- `InductionProver`：基础步→归纳步→结论（Σ ε_j < ε_global → T_conv）
- `MemoryLeakDetector`：r = Δmem/Δt，T_OOM = (limit - current)/r

### 2.3 Stosszahlansatz → 告警降噪（noise 包）

**邓煜原型**：严格证明足够大规模、足够稀疏耦合下，粒子分布可分解为近似独立。

**AIOps 映射**：

```
条件 1：N ≥ N_min（系统足够大）
条件 2：S > τ（耦合足够稀疏，S = 1 - ||C||₀/N²）
结论：sup|P(a_i,a_j) - P(a_i)P(a_j)| ≤ K/N → 0
→ 大多数同时告警是巧合 → 可安全降噪
```

**核心算法**：
- `CouplingSparsityAnalyzer`：S = 1 - ||C||₀/N²
- `IndependenceChecker`：sup|P(AB)-P(A)P(B)| < ε_max
- `StossDenoiser`：trueAlarms / coincidentalAlarms / groupedAlarms 三分法

### 2.4 BBGKY Hierarchy → 多服务耦合截断（scaling 包）

**邓煜原型**：N-粒子分布函数的层级 f₁, f₂, ..., f_k。截断：E_k/E_{k-1} < η。

**AIOps 映射**：
- f₁ = 单服务故障概率
- f₂ = 双服务故障传播
- E_k/E_{k-1} < 0.01 → 截断到 k-1

### 2.5 Boltzmann-Grad 极限 → 规模分析（scaling 包）

**邓煜原型**：N→∞, d→0, Nd²=常数。

**AIOps 映射**：
- N = 服务数量（增长）
- d = 故障影响半径（随熔断/限流缩小）
- Nd² = 全局故障影响密度（必须保持恒定）
- 若 Nd² 偏离常数 → 进入 dense regime → 级联故障不可避免

**故障概率渐近**：P_fault(N) = P₀ + A/N + B/N² + O(1/N³)

### 2.6 波动理学方程 → 告警级联传播（wave 包）

**邓煜原型**：∂_t n(k) = ∫ T(k,k₁,k₂)[n₁n₂ - nk(n₁+n₂)]dk₁dk₂

**AIOps 映射**：I(s,t+Δt) = I(s,t) + Δt Σ T(s,s',s'')[I(s')I(s'') - I(s)(I(s')+I(s''))] - γ×I(s,t)

**关联衰减**：C(t) = C₀ × exp(-t/τ)，τ = 1/spectralGap

---

## 3. DI 容器架构

```
                                         ┌─────────────────────┐
                                         │  createDefaultContainer()  │
                                         │  @micro-kinetic      │
                                         └──────────┬──────────┘
                                                    │ registers
                    ┌───────────────┬───────────────┼───────────────┬───────────────┐
                    ▼               ▼               ▼               ▼               ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
              │   tree   │  │ cutting  │  │  noise   │  │ scaling  │  │   wave   │
              │  模块    │  │  模块    │  │  模块    │  │  模块    │  │  模块    │
              └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
                   │             │             │             │             │
                   └─────────────┴──────┬──────┴─────────────┴─────────────┘
                                        │ depends on
                                        ▼
                              ┌─────────────────┐
                              │  micro-kinetic- │
                              │  core (ZERO deps)│
                              │  类型/接口/DI Token│
                              └─────────────────┘
```

---

## 4. 科学计算后端分层

```
应用层                        IRCAEngine / IDenoiseEngine / ...
                                │
接口层                IMatrixOps / IStatistics / ILinearAlgebra
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
实现层      NumpyTsMatrixOps  UbiqueLinearAlgebra  DecimalProvider
            (numpy-ts)       (Rust nalgebra WASM)   (decimal.js)
             94% NumPy API     26× faster det       50-digit precision
```

运行时通过 DI 容器热替换数学后端，无需修改任何引擎代码。

---

## 5. 数据流

```
ServiceCallGraph + TimeSeries[]
        │
        ▼
┌───────────────────┐
│  1. 碰撞树剪枝      │  ← JohnsonCycleDetector → TreePruner
│     (tree 包)      │     环检测 → w(C) < ε 剪枝 → 树上 RCA
└────────┬──────────┘
         ▼
┌───────────────────┐
│  2. 慢性故障检测    │  ← AdaptiveWindowCutter → InductionProver
│     (cutting 包)   │     72h → N 窗 → ε_j 误差界 → T_conv
└────────┬──────────┘
         ▼
┌───────────────────┐
│  3. 告警降噪       │  ← CouplingSparsityAnalyzer → StossDenoiser
│     (noise 包)     │     S > τ → 独立 → 降噪
└────────┬──────────┘
         ▼
┌───────────────────┐
│  4. 规模分析       │  ← BBGKY Hierarchy → BoltzmannGradLimit
│     (scaling 包)   │     E_k/E_{k-1} < η 截断 → P_fault(N) 渐近
└────────┬──────────┘
         ▼
┌───────────────────┐
│  5. 告警传播模拟   │  ← WaveCascadeModel → CorrelationDecay
│     (wave 包)      │     WKE 离散化 → C(t) = C₀·exp(-t/τ)
└───────────────────┘
```

---

## 6. 文件组织

```
micro-kinetic-ts/
├── packages/
│   ├── core/src/        # 接口契约 + 类型 + DI Token + 异常 + 工具
│   │   ├── types/       #   7 个类型模块
│   │   ├── interfaces/  #   6 个引擎 + 1 个 math-provider 接口
│   │   ├── di/          #   Token 定义 + Container + Registry
│   │   ├── exceptions/  #   4 个异常家族
│   │   └── utils/       #   invariant 断言
│   ├── tree/src/        # 碰撞树 RCA
│   │   ├── graph/       #   图构建 + 环检测 + 邻接矩阵
│   │   ├── pruning/     #   碰撞贡献 + 阈值定理 + 剪枝器
│   │   ├── rca/         #   树上 RCA + 排序 + 置信度
│   │   └── math/        #   numpy-ts + ubique 后端
│   ├── cutting/src/     # 切割算法
│   │   ├── segmentation/#   自适应 + 固定窗口切割
│   │   ├── convergence/ #   局部误差估计 + 归纳证明
│   │   └── chronic/     #   内存泄漏 + 连接池 + 劣化曲线
│   ├── noise/src/       # 告警降噪
│   │   ├── stoss/       #   耦合稀疏度 + 独立性检验 + 降噪器
│   │   └── math/        #   decimal.js + simple-statistics 后端
│   ├── scaling/src/     # 规模分析
│   │   ├── bbgky/       #   层级构建 + 截断 + 张量
│   │   └── boltzmann-grad/ # 标度分析 + 故障概率渐近
│   ├── wave/src/        # 告警传播
│   │   └── cascade/     #   级联模型 + 模拟器 + 阈值估计
│   └── kinetic/src/     # 伞包
│       ├── di/          #   全局容器组装
│       ├── pipeline/    #   全流程 Pipeline
│       └── cli/         #   CLI (commander)
└── integration-tests/   # 跨包集成测试
```

---

## 7. 构建与工具链

| 工具 | 选择 | 理由 |
|------|------|------|
| 包管理器 | pnpm 9.x | workspace protocol |
| TypeScript | 5.7+ strict | NodeNext module |
| 构建 | tsup | ESM + CJS 双输出 |
| 测试 | Vitest 3.x | 原生 ESM + v8 coverage |
| Lint | oxlint + ESLint 9 | 极速 + 全面 |
| 编排 | Nx 20+ | 增量构建 + 缓存 |
| 版本 | Changesets | 独立版本 |
| CI | GitHub Actions | 矩阵 test + benchmark diff |

---

## 8. 版本策略

```
MAJOR.MINOR.PATCH

MAJOR: core 包接口契约破坏性变更
MINOR: 新算法模块 / 新引擎实现
PATCH: Bug 修复 / 性能优化

所有 7 个包处于 linked 版本组（Changesets linked mode），
保证兼容性。
```
