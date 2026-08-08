# CI Benchmark Fix Plan

Updated: 2026-08-08 09:03 CST

## Status: QUALITY PASS COMPLETE — Commit a609bc6

## Fixes Applied

### P0: RE2 OOM
- loadSingleCase extraction (rawCase released after conversion)
- Event-loop yield every 50 cases + GC calls between ablation configs
- NODE_OPTIONS=--max-old-space-size=6144 on all 6 CI steps

### P1: RE3 100% trace pruning
- Guard: callFrequency empty → return original call graph unchanged
- CSV column fallbacks: parent_span, parentSpanId, parent_span_id, parentSpan

### P2: TrainTicket RE1 0% AC@1
- Min-max normalization with ≥20 node threshold (preserves small topologies)

### Code Quality
- Removed dead GC hack (const _ = undefined)
- Restored original test assertions for small graphs
- Added 2 normalization tests (small graph vs large graph)
- Prettier formatting applied

### Verification
- pnpm test: 89/89 files, 1981/1981 tests, 0 failures
- pnpm typecheck: pass
- pnpm build: success
