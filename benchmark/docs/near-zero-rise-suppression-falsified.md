# Near-zero-baseline rise suppression — falsified (no-op, direction #11)

**Status:** empirical readback. The opt-in `suppressNearZeroBaselineRise`
signal (commit `13e7cc3`) is a **no-op** on RCAEval: benchmark run
`34227145755` is bit-identical to the golden baseline on all 9 cells
(RE1/RE2/RE3 × OB/SS/TT). It neither moves RE3 nor regresses RE1/RE2.
The default stays `false`.

## The hypothesis it was built on

Reading the offline metric dump (`artifacts/dump-ss`) suggested the #1 false
positive outranking the GT crash source is a near-zero-baseline metric —
`rabbitmq-exporter::cpu` with `head=0.0001`, i.e. a 0.0001 → 0.003 "rise"
that explodes `riseRatio` and produces `dev ≈ 1.5` while the genuine crash
drop is hard-capped at `log10(2) ≈ 0.301`. The signal skipped any metric
whose `baselineMean ≤ 0.001` before computing deviation.

## Why it is a no-op (and the precision error it corrects)

That hypothesis conflated two views of "the top1 that outranks GT":

1. **Raw metric-deviation view** (what `dump-ss` dumps): the highest raw
   deviation in a failing case is indeed `rabbitmq-exporter::cpu`
   (`dev ≈ 1.52`, near-zero baseline).
2. **Production ranking view** (rank normalization + trace/topo fusion): the
   actual top1 is `front-end::error` (`base ≈ 0.17`, `dev ≈ 1.6`) — an
   upstream caller whose baseline is NOT near zero.

The production top1 `base` across all 35 RE3 cases ranges from `0.008` to
`8.3e7`. **None is `≤ 0.001`**, so the guard never fires, hence the perfect
no-op. The near-zero-baseline metric (`rabbitmq-exporter::cpu`) is already
demoted below top-1 by rank normalization + trace/topo fusion — it appears at
4th in the Top-K at best, never first.

## Evidence: production top1 signature (SS RE3 failures, run 34227145755)

| top1 metric | base | dev | shape | count |
|---|---|---|---|---|
| `front-end::error` | 0.156–0.184 | 1.62–1.76 | drop (5.8–9.8 → 2–2.5) | 6 |
| `orders::error` | 0.174–0.239 | 1.01–1.19 | drop (1.9–2.5 → 0.2–0.27) | 2 |
| `orders-db::diskio` | 2.08M–3.30M | 0.46–0.60 | rise (3.1M → 6–9.6M) | 2 |
| `carts-db::diskio` | 615575 | 1.32 | (head/tail sampled 0) | 1 |
| `rabbitmq-exporter::cpu` | 0.0001 | 1.52 | near-zero rise | **never top1** |

## Conclusion

- The near-zero-baseline rise IS a real leak in the **raw-deviation** view, but
  rank normalization + trace/topo fusion already resolves it in production.
- The production RE3 gap is driven by `front-end::error` (upstream caller
  error drop, `base ≈ 0.17`) and `*-db::diskio` (million-scale baseline) —
  **not** near-zero baselines.
- This corrects the precision of `docs/reverse-propagation-falsified.md`
  ("outranking victims are near-zero-baseline RISE artifacts"): the *raw
  deviation* winner is near-zero, but the *ranking* winner is not.

## Flag disposition

Kept as an opt-in probe (default `false`), consistent with
`suppressIdleTransients`: it documents a real leak that only surfaces when
rank normalization is disabled, costs nothing when off, and is covered by
3 unit tests (skip / crash-drop preservation / event-burst preservation).
No default flip; no regression.
