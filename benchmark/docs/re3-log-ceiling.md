# RE3 log-signal ceiling: the LLM code-level headroom is empirically falsified

## Question under test (H1)

Before building an LLM exception classifier (direction B), we asked whether the
deterministic log signal — `LOGIC_EXCEPTION_PATTERN` whitelist +
`PROPAGATED_EXCEPTION_PATTERN` + novelty IDF — **misses a failing code-level
source**. The only scenario where an LLM would add value is a ground-truth
source that throws an exception which is *neither* whitelisted as logic *nor*
classified as propagated: a whitelist-missed **logic** exception.

`classifyExceptionKind(message)` projects every exception-bearing log line into
four buckets: `logic` / `propagated` / `unclassified` / `none`. The
`unclassified` bucket is the semantic gap where a whitelist-missed logic
exception (LLM-recoverable) coexists with connectivity/token noise (correctly
ignored). H1 holds **iff** the failing cases' ground-truth sources land in
`unclassified` with a *logic* class name.

## Measurement (dump run `34198157294`, 90 RE3 cases, all three systems)

`scripts/dump-re3-exceptions.ts` sampled every RE3 case's post-injection
ERROR/FATAL lines, folded them into a per-service
logic/propagated/unclassified inventory, and emitted a per-case verdict for the
ground-truth source.

### Verdict histogram

| Verdict | Count | Meaning |
|---|---|---|
| LOGIC | 12 | GT throws a whitelisted logic exception; log signal already ranks it |
| SILENT | 57 | GT emits no exception-bearing ERROR/FATAL lines |
| UNCLASSIFIED | 21 | GT throws an exception outside the whitelist and not propagated |

### UNCLASSIFIED ground-truth class names (the only candidate LLM headroom)

| Case | GT source | Class names | Kind |
|---|---|---|---|
| `re3ob_adservice_f5_{1..3}` (3) | adservice | `BindException`, `IOException` | **connectivity/IO** |
| `re3ss_carts_f1_{1..4}` (4) | carts | `ConnectException`, `MongoSocketOpenException` | **connectivity/DB** |
| `re3ss_carts_f3_{1..4}` (4) | carts | `ConnectException`, `MongoSocketOpenException` | **connectivity/DB** |
| `re3ss_carts_f4_{1..4}` (4) | carts | `ConnectException`, `MongoSocketOpenException` | **connectivity/DB** |
| `re3ss_orders_f3_{1..3}` (3) | orders | `ConnectException`, `MongoSocketOpenException` | **connectivity/DB** |
| `re3ss_orders_f4_{1..3}` (3) | orders | `ConnectException`, `MongoSocketOpenException` | **connectivity/DB** |

Every one of the 21 `unclassified` cases is a **connectivity / IO / database
transport** exception, not a whitelist-missed logic exception.

## Why H1 is falsified

1. **No whitelist-missed logic exception exists.** The 12 LOGIC cases already
   cover every logic exception in the corpus (`NullPointerException`,
   `AttributeError`, `TypeError`, `HttpMessageNotReadableException`,
   `JsonMappingException`, `IllegalArgumentException`). The 21 UNCLASSIFIED
   cases are all `BindException` / `IOException` / `ConnectException` /
   `MongoSocketOpenException` — transport-level noise that the whitelist is
   *correctly* refusing to treat as a logic source signal.

2. **Connectivity exceptions carry no source-vs-symptom semantics.** In a
   fan-in topology (SS carts/orders), a downstream DB outage makes the callee
   throw `MongoSocketOpenException`, while every upstream caller simultaneously
   throws its own `ConnectException` wrapping the same root cause. The class
   name alone cannot tell source from victim — and an LLM sees only the class
   name, not a decision boundary the class name doesn't encode.

3. **The SILENT majority is unreachable by any log signal.** 57 of 90 cases
   (every TT case, every SS front-end case, most OB f1/f3 cases) have no
   exception content at all — the fault is a socket drop / CPU / memory /
   network condition that raises no exception. An LLM has no text to reason
   about.

## Conclusion

Direction B (LLM code-level classification) is **empirically rejected** before
any LLM code is written. The deterministic `classifyExceptionKind` inventory
proves the deterministic log signal already covers 100% of the recoverable log
semantics, and the residual is split between transport noise (uninformative)
and silence (unreachable). Combined with the metric-side drop/rise asymmetry in
`docs/re3-fault-ceiling.md`, the RE3 error-value ceiling is now characterized on
*both* axes — metric and log — and neither offers an LLM-recoverable gap.

This does not remove the instrumentation: `classifyExceptionKind` +
`scripts/dump-re3-exceptions.ts` remain as a permanent, cheap regression probe
so any future corpus change that introduces a real logic-exception gap is caught
immediately rather than assumed away.
