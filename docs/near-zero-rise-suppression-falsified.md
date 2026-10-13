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

---

## 2026-10-13 — the SIBLING switch measured, and the "consistent with" claim above is falsified

The paragraph above closes by keeping `suppressNearZeroBaselineRise` as an opt-in probe **"consistent with
`suppressIdleTransients`"**. That claim was an INFERENCE from a shared shape — two guards, two near-zero
baselines — and it was never tested. It has now been tested, and the two switches are **not consistent**:
`suppressIdleTransients` is not a no-op.

### The measurement

Run **`38329682118`** on `4a10014` (`suppress_idle_transients=1`) against **`38329642349`** on the SAME
revision, so the dispatch input is the only difference. The candidate's own artifact states the field.

| cell | published | candidate | Δ |
| --- | ---: | ---: | ---: |
| RE1-OnlineBoutique | 80.0% | **80.8%** | **+0.8** |
| RE1-SockShop | 92.8% | 92.8% | 0 |
| RE1-TrainTicket | 68.0% | 68.0% | 0 |
| RE2-OnlineBoutique | 86.7% | 86.7% | 0 |
| RE2-SockShop | 92.2% | 92.2% | 0 |
| RE2-TrainTicket | 71.1% | **73.3%** | **+2.2** |
| RE3 (all three) | 80.0 / 45.0 / 51.1 | identical | 0 |

Per case, from the two loss censuses: **RE1 1 fixed / 0 broken, RE2 5 fixed / 3 broken, RE3 0 / 0** — a net of
**+3 cases of 735**. Two cells improved, seven unchanged, and **no cell's average fell**.

### And it is NOT the no-op the paragraph above predicted, because the failure is SYSTEMATIC

The three lost cases are **all `disk` faults on TrainTicket** (`ts-order-service_disk_2`,
`ts-route-service_disk_1`, `ts-travel-service_disk_1`), and the five gained are `cpu` / `mem` / `socket` faults
on the same system. So this is not noise on either side. The term-level diff says why:

- **On a GAINED case the guard removed a metric from a RIVAL.** The truth's own `selfAnomalyLog1p` RISES to
  exactly `0.693147` — the top of the rank grid, `log₁p(1)` — because the false leader was knocked out of the
  rank-1 tie by the loss of ITS metric. Rank normalisation is on for this system (68-69 nodes), so the anomaly
  is a POSITION and removing a metric from any service can move another service up it.
- **On a LOST case the guard removed a metric from the TRUTH.** The truth's `selfAnomalyLog1p` FALLS
  (`0.69315 → 0.61559`, `→ 0.46814`, `→ 0.59933`) and its rank goes `1 → 11`, `1 → 28`, `1 → 13`.

So the discriminator the guard lacks is not a property of the METRIC — head ≈ 0, a rise, a return near the
start — but of its OWNER: **an idle metric that woke up because its service is the fault source looks exactly
like one that woke up for an unrelated reason.** On TrainTicket a `disk` fault's signature IS an
idle→active disk metric, which is why the loss is concentrated in that one fault type. The guard's shape test
cannot tell the two apart, and the fix is a context feature, not a threshold.

### Disposition

**Not shippable as an unconditional default**, and this is the criterion's second half doing its job: the net
is positive, but **RE2-TrainTicket's `disk` column regresses `73.3% → 53.3%` (−20.0pp)** — a regressed fault
type — while `cpu` gains `+20.0`, `mem` and `socket` `+6.7` each. The default therefore stays `false`, and the
switch becomes a **ROUTING candidate with a measured target**: separate "the metric belongs to the source" from
"the metric belongs to a bystander", on a free read, before any run.

`suppressNearZeroBaselineRise` keeps its no-op verdict and its own explanation, which is a different mechanism:
its guard tests the BASELINE MEAN, and the production top-1's baseline ranges from `0.008` to `8.3e7`, so the
`0.001` epsilon is never cleared and the guard never fires. The idle-transient guard tests the FIRST SAMPLE, and
that is `0` often enough to fire. **Two switches, two mechanisms, one shared shape, and the shape is why the
"consistent with" sentence was written and wrong.**

### What this correction changes downstream

1. **A false statement is removed from this document**, and the disposition paragraph above no longer asserts
   a symmetry it never measured.
2. **`suppressIdleTransients` becomes the first member of its own register row** — absent until now, which
   meant a proposer searching for it in `docs/*.md` would have found nothing.
3. **And the mirror of iteration 96 exists because of it.** The measured gain could not ship while the FSE'26
   half was unstatable — `fse26-cli.ts` did not accept `--suppress-idle-transients` at all — so a golden-side
   improvement had an undecidable other half. That is `dispatch-surface-audit.md`'s boundary argument arriving
   as a number rather than as a principle.
