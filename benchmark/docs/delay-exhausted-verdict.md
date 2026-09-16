# Delay Fault Deterministic Attack — Verdict: Exhausted

## Context

After `loss` was ruled weak-source (`docs/loss-weak-source-verdict.md`), `delay` was
the last fault type with plausible deterministic headroom: engine AC@1 80.4% vs union
ceiling 90.2% (10.0pp gap, 10 bothWrong). This iteration answers the readback
criterion — is the delay GT source mostly rank-1 (strong signal, crackable) or
rank>1 (weak source, dead end)?

## Method

Generalized the dump tool (`scripts/dump-loss-metrics.ts`) with a `--fault-type`
flag (commit `8caff66`). It mirrors the topology-fault-graph baseline and prints the
GT source's dominant metric deviation direction, magnitude, and rank among all
`(service × metric)` pairs. Joined against routing-probe records via
`.git/analyze_fault_dump.py`.

## Readback (run `34336557726`, 102 joined cases)

### GT rank distribution (deviation rank)

| rank | count |
|------|-------|
| 1    | 84 (82.4%) |
| 2    | 3  |
| 3    | 1  |
| 5    | 2  |
| 6    | 3  |
| 7    | 2  |
| 9    | 2  |
| 10   | 1  |
| 12   | 2  |
| 26   | 1  |
| 32   | 1  |

82.4% rank-1 — **strong signal**, the opposite of loss (91% weak-source).

### Engine / PRISM / union

| metric | cases | AC@1 |
|--------|-------|------|
| engine | 82 | 80.4% |
| prism  | 76 | 74.5% |
| union  | 92 | 90.2% |

Split: bothCorrect 66 / engineOnly 16 / prismOnly 10 / bothWrong 10.

### Engine-wrong breakdown

- 6 rank-1 ("should be fixable") → 4 prism-recoverable + 2 bothWrong
- 14 rank>1 (weak source) → structurally irreducible

## The 6 rank-1 engine-wrong cases

**4 prism-recoverable (fusion already covers them):**

| case | GT source | engine→ | prism→ |
|------|-----------|---------|--------|
| re1ob_adservice_delay_3 | latency-50 dev 1.715 | checkoutservice | adservice ✓ |
| re1ob_adservice_delay_4 | latency-50 dev 1.705 | checkoutservice | adservice ✓ |
| re1ob_productcatalogservice_delay_1 | latency-50 dev 2.406 | frontend (0.875 vs 0.848) | productcatalogservice ✓ |
| re1tt_ts-order-service_delay_3 | latency-90 dev 1.206 | inside-payment | ts-order-service ✓ |

Note `productcatalogservice_delay_1`: the engine margin is razor-thin (frontend
0.875 vs GT 0.848), i.e. a prior override of a near-tie.

**2 bothWrong (full-drop signature, both engines miss):**

| case | GT source | engine→ | prism→ |
|------|-----------|---------|--------|
| re2tt_ts-auth-service_delay_2 | diskio dev 2.915 DROP (drop=1.00) | preserve-service | security-mongo |
| re2tt_ts-auth-service_delay_3 | diskio dev 2.819 DROP (drop=1.00) | preserve-other | auth-mongo |

The GT source's dominant signal is a **full diskio drop to zero**. Both engines read
that as a victim signature (service halted I/O) and rank the mongo dependency's rise
higher. This is the delay analog of the loss asymmetry: a full drop is
indistinguishable from a victim's I/O halt, and the downstream dependency's rise is a
near-equal competing signature.

## Why not crackable

1. The engine is already at 80.4%, only 2.0pp below the rank-1 ceiling (82.4%) —
   the deviation signal is near-fully exploited. There is no untapped rank-1 mass.
2. The only "new" rank-1 misses (2) are full-drop diskio (`drop=1.00`), structurally
   ambiguous. No deterministic rule separates "source halted its own I/O" from
   "victim's I/O halted by upstream congestion".
3. The bothWrong floor is 10 (9.8%): 8 weak-source (same-type as loss) + 2
   full-drop. Fusion's union (90.2%) is the achievable deterministic ceiling.

## Conclusion

`delay` is a *different* failure mode from `loss` — strong signal (82.4% rank-1), not
weak source — but its deterministic headroom is equally exhausted. The engine sits at
its rank-1 ceiling; the residual rank-1 misses are fusion-covered or full-drop
ambiguous; the bothWrong floor is weak-source dominated.

**The deterministic path is now fully exhausted across both `loss` and `delay`.** The
bothWrong hard floor (77/615 = 12.5% overall) is the ultimate deterministic limit and
the union ceiling is ≈ 87.5%. Remaining levers: cross-benchmark de-risk (P1) and gated
LLM (P3). See `docs/sota-roadmap-2026.md`.
