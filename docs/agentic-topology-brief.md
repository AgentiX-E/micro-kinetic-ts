# The topology brief — what the model is told, and why it is one string for the corpus

`--topology-brief-out` writes the union of every case's call graph as the section a nomination prompt can carry;
`--topology-brief` reads it back into the prompt. This document records the gap it fills, the guard that makes it a
channel rather than a leak, what it costs, and the arm it was built for (`preregistration-306.md`, arm T).

## 1. The gap, stated as a property of the prompt rather than a belief about the model

`buildNominationPrompt` sends two things: the fault type, and one table row per candidate. A row carries the
channels that moved, their fault-free bands, the crossing rate and the onset. That is everything about a *service*
and nothing about the *graph*.

| what a row says | what no row says |
| --- | --- |
| `ts-basic-service`'s p99 left its band at 4 200 ms, crossed at 2 % of fault-free windows | `ts-travel-service` calls `ts-basic-service` |
| `ts-travel-service`'s p99 left its band too | which of the two is upstream of the other |

The engine itself encodes exactly this quantity: the containment pass (`docs/containment-order.md`) inverts an
adjacent pair only when it is a direct call edge. So the missing piece is not a modelling opinion — it is the one
piece of system knowledge an operator has and the prompt does not.

## 2. Why one string per corpus, and why that is the guard rather than the budget

The obvious repair — render the edges among the candidates on the table — is refused.

A text that differs by case is a **per-case input**, and a per-case input can carry the answer without ever printing
it: it is enough that some part of its rendering correlates with the label. Nothing in this repository could audit
such a rendering for leakage, because the audit would have to enumerate every function of the label that the
renderer might have learned. So the brief is a property of the **corpus**: one union graph, one string, byte-identical
for every case in the population.

That makes the leak structurally impossible rather than merely unobserved, and it makes the guard checkable:

| guard | where it is asserted |
| --- | --- |
| the section is byte-identical for every case in a corpus | `benchmarks/__tests__/agentic-topology-channel.test.ts` — a four-case corpus with different fault types, orders and labels |
| relabelling every case leaves the brief and its digest unchanged | the same file, on a corpus whose accepted sets are replaced by the candidate lists in reverse order |
| the derivation is given the union and the population size, and nothing else | `TopologyUnion.addCase(edges)` — the type has no field a label could occupy |
| the digest moves when the brief moves | `packages/ai/__tests__/unit/topology-brief.test.ts`, one edge changed |

The price of that choice is that the brief cannot be trimmed to the candidates on the table: it states the whole
union. On the FSE'26 corpus that is 49 services and every call edge the corpus observed, which is the size the
measure job prints and §4 prices.

## 3. The instrument, exactly

| layer | addition | default |
| --- | --- | --- |
| `packages/ai/src/agent/topology-brief.ts` | `renderTopologyBrief`, `TopologyUnion` | — |
| `packages/ai/src/agent/nomination.ts` | `NominationOptions.topologyBrief` | `''` — **no section, prompt byte-identical to today** |
| `benchmarks/src/run-fse26.ts` | `--topology-brief-out <path>` | absent |
| `benchmarks/src/run-agentic-nomination.ts` | `--topology-brief <path>` | absent |
| `.github/workflows/benchmark-agentic.yml` | input `topology_brief` (`''` = off, `auto` = derived) | `''` |

The section sits between the `FAULT TYPE` line and the `CANDIDATES` line, and it costs exactly `brief.length + 2`
characters — asserted rather than estimated, because that is the quantity a dispatch's bill is computed from.

The record is one ndjson line with six fields: `system`, `cases`, `services`, `edges`, `digest`, `brief`. The reader
re-derives the digest rather than trusting it, refuses a file that holds more than one brief (the corpus declares no
per-case system, so a second brief cannot be attributed), and refuses an empty brief — "no brief" is the absence of
a file, not a record.

## 4. What it costs

The charge is `chars × cases` in prompt tokens, and it is not a constant across corpora: it is a function of the
number of distinct edges the corpus observed. `run-fse26` prints the exact figure at dispatch —

```
Topology brief: 49 services, N call edges over 1422 cases, C chars (~C/4 tokens estimated), digest <16 hex>
```

— and the study prints the same digest beside its arm table, so a replay names the bytes it used. The `chars / 4`
divisor is an estimate and is named one; the provider's own count is what the run's token total reports.

This is the third instrument whose cost had to be *measured* rather than assumed. The width's first pricing was
wrong by a factor of four (`docs/agentic-presentation-width.md` §5, `3.99×`); the lesson recorded there applies
here verbatim: a cost written before the artifact exists is a guess about the artifact's size, and the guess is
always about the wrong quantity.

## 5. What it says, and what it refuses to say

It says: what an edge is (``A -> B`` reads "A calls B"), how many services and edges the union holds, over how many
cases, which services nothing calls, and which services call nothing. The last two are printed because absence has
two meanings that arrows cannot show: a service nothing calls is an entry point, and a service that calls nothing is
a leaf.

It does **not** say which end of a bad edge is usually the source. That is a hypothesis about causation, and an arm
whose channel already contains the answer measures nothing. The distinction is asserted: the renderer's text may not
contain the words a directional hint would use.

## 6. What this is not, and what it therefore cannot refute

Arm T's brief is **derived**. `arXiv:2609.36686` moves its reranker `+7` to `+18` points with a description a person
wrote — one that states purpose as well as structure. A derived brief is weaker by construction: it can say who calls
whom and it cannot say what a service is for.

So if arm T fails, the paper's number is not refuted. What is refuted is the claim that the **derivable part** of it
is enough. A hand-written document stays open, priced separately, and would need its own provenance argument,
because it is not reproducible from a dispatch.

## 7. The reading it exists for

`preregistration-306.md` fixes the arm and the four predictions, T1–T4, before the dispatch exists. This document
records the instrument; the readback is written after the run and lands in `closed-axes-register.md`, on the rule the
width's pair of entries (§309, §310) established: the instrument and the reading are two documents, and the second
one is not written by the author of the first's hopes.
