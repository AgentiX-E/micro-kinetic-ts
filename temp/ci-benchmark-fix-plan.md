# CI Benchmark Fix Plan

Created: 2026-08-08 08:46 CST
Updated: 2026-08-08 08:58 CST

## Status: ALL FIXES COMMITTED & PUSHED (061089c)

## Issues Found & Fixed

### ✅ P0: RE2 OOM (heap exhausted)
- Commit: 061089c
- Fix: loadSingleCase extraction + event-loop yield + GC hints + NODE_OPTIONS

### ✅ P1: RE3 100% trace pruning
- Commit: 061089c
- Fix: Guard in augmentTopologyWithTraces + CSV column fallbacks

### ✅ P2: TrainTicket RE1 0% AC@1
- Commit: 061089c
- Fix: Min-max normalization of anomaly scores

## Files Changed
- packages/kinetic/src/signals/trace-topology.ts — O(n²)→O(n) + edge guard
- packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts — CSV column fallbacks
- packages/tree/src/causal/topology-fault-graph.ts — anomaly score normalization
- benchmarks/src/run-rcaeval.ts — loadSingleCase extraction
- benchmarks/src/run-ablation.ts — GC hints + event-loop yields
- .github/workflows/benchmark-rcaeval.yml — NODE_OPTIONS
- packages/kinetic/__tests__/unit/trace-topology.test.ts — updated assertions
- packages/tree/__tests__/causal/topology-fault-graph.test.ts — updated assertions

## Verification
- pnpm test: 89/89 files, 1978/1978 tests, 0 failures
- pnpm typecheck: pass
- pnpm format:check: pass
- pnpm lint: pass

## Next Step
- Trigger benchmark workflow to verify fixes in CI
