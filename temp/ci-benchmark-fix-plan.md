# CI Benchmark Fix Plan

Created: 2026-08-08 08:46 CST

## Issues Found

### P0: RE2 OOM (heap exhausted)
- RE2 main benchmark OOM at ~80s (78452ms GC compaction)
- RE2 ablation OOM
- RE3 ablation OOM
- Root cause: All cases + traces loaded into memory simultaneously
- Fix: Stream processing / batch loading

### P1: RE3 trace pruning 100% reduction
- OnlineBoutique: 24→0 edges, TrainTicket: 267→0 edges
- All scores 0% / N/A
- Root cause: augmentTopologyWithTraces incompatible with RE3 span format

### P2: TrainTicket RE1 0% AC@1
- OnlineBoutique 60%, SockShop 58.4%, TrainTicket 0%
- TrainTicket has 51-exact-edge complex topology
- Root cause: Root cause scoring algorithm not handling complex topo

### P3: RE1 regression vs previous runs
- Need to compare with previous benchmark results
- Ablation shows ALL configs same (0% A@1, 25.7% TA) — algo is flat across features

## Investigation Plan

Phase 1: Deep dive into each issue
Phase 2: Fix with scientific test validation
Phase 3: Verify end-to-end

## Current Progress
Phase: 1 — Investigation
