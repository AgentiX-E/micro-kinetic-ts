# Contributing to Micro-Kinetic TS

Thank you for contributing to Micro-Kinetic TS — the TypeScript implementation of Deng Yu's kinetic theory applied to AIOps root cause analysis.

## Development Setup

```bash
git clone https://github.com/AgentiX-E/micro-kinetic-ts.git
cd micro-kinetic-ts
pnpm install --frozen-lockfile
pnpm build
```

**Requirements**: Node.js ≥22, pnpm ≥9.15.0 (auto-detected from `packageManager`).

## Monorepo Structure

```
packages/
├── core/       @agentix-e/micro-kinetic-core      Zero-dependency contracts (types, interfaces, DI tokens, exceptions)
├── tree/       @agentix-e/micro-kinetic-tree       Collision Tree RCA engine
├── cutting/    @agentix-e/micro-kinetic-cutting    Cutting algorithm — chronic fault detection
├── noise/      @agentix-e/micro-kinetic-noise      Stosszahlansatz — alert denoising
├── scaling/    @agentix-e/micro-kinetic-scaling    BBGKY hierarchy + Boltzmann-Grad scaling
├── wave/       @agentix-e/micro-kinetic-wave       Wave kinetic equation — alert propagation
└── kinetic/    @agentix-e/micro-kinetic            Umbrella: DI assembly + CLI + Pipeline + Benchmark
```

Each package is independently versioned with Changesets. Inter-package dependencies use `workspace:^`.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all unit tests (workspace mode) |
| `pnpm test:all` | Run unit + integration tests |
| `pnpm lint` | Run oxlint across all source files |
| `pnpm format` | Auto-format with Prettier |
| `pnpm format:check` | Check formatting (CI) |
| `pnpm typecheck` | TypeScript type checking for all packages |
| `pnpm benchmark` | Run synthetic benchmark suite |

To target a single package:
```bash
pnpm nx test @agentix-e/micro-kinetic-core -- --coverage
pnpm nx build @agentix-e/micro-kinetic-tree
```

## Coverage Standards

Every package must maintain **≥95% coverage** on all four dimensions:

| Dimension | Threshold |
|-----------|-----------|
| Statements | ≥95% |
| Branches | ≥95% |
| Functions | ≥95% |
| Lines | ≥95% |

Coverage provider is `v8` (vitest). Barrel `index.ts` files, pure type files, and DI registry files are excluded from coverage. See each package's `vitest.config.ts` for exact exclusion rules.

## Testing Philosophy

**Discovery-driven, not padding-driven.** Every test must exercise a real failure mode or edge case — never write tests just to hit coverage numbers.

- **Boundary-driven**: Each uncovered branch represents an untested decision path. Add tests that exercise the boundary conditions.
- **Deterministic**: Use fixed seeds (`SyntheticBenchmarkGenerator(42)`) for reproducible results. No random data in tests.
- **Isolation**: Mock DI dependencies via the Container. Test each component independently before integration.

## Commit Conventions

All commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

- Bullet points for details
```

Common types: `feat`, `fix`, `test`, `refactor`, `style`, `docs`, `ci`, `chore`.

**All commit messages, code comments, and documentation must be in English.**

## CI Pipeline

On every push to `main`:
1. **Lint** — oxlint + Prettier format check
2. **Typecheck** — `tsc --noEmit` on all packages
3. **Test** — Matrix of 7 package tests with coverage, plus integration tests
4. **Release** — Changesets version bump PR creation (publish requires `NPM_TOKEN` secret)
5. **Benchmark** — RCAEval real dataset benchmark (requires cache from `cache-datasets`)

## Dependency Injection

The project uses a custom Symbol-based DI container (`Container` in core). Key patterns:

```typescript
// Registration
container.register(DI_TOKENS.RCA_ENGINE, (c) => new CollisionTreeRCAEngine(c));

// Resolution
const engine = container.resolve<IRCAEngine>(DI_TOKENS.RCA_ENGINE);

// Testing with mocks
container.remove(DI_TOKENS.RCA_ENGINE);
container.register(DI_TOKENS.RCA_ENGINE, () => mockEngine);
```

All DI tokens are `Symbol.for('micro-kinetic:*')` — avoid magic strings.

## Architecture

For detailed architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For the underlying theory, see the [research paper](./micro-kinetic-ts-docs/PAPER.md).
For the audit and evaluation framework, see [AUDIT.md](./micro-kinetic-ts-docs/AUDIT.md).
