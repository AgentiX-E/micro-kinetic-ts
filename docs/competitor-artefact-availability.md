# Competitor artefact availability — what our SOTA record claims, and what RESOLVES

## Why this document exists

`sota-comparison.md` §2b-ii closes with a sentence that plans work:

> … **confirm the case set from the paper's own dataset section, and run their code on ours** — the five
> reproducible references have all been reproducible and none has been run …

**That sentence is a plan built on a fact nobody checked.** It is a COUNT ("five"), and a count is a copy of a
list the list does not own — `docs/closed-axes-register.md` law 16. This document is the inventory that
replaces it, and running it found **five defects in our own record**, one of which closes the plan.

The distinction the record had been collapsing is the one `closed-axes-register.md` law 10 draws, taken one
step further. Law 10 says *a paper's own artefact statement is the authority on whether its artefact is
public*. The corollary nobody wrote down is that **a statement that code is available is not evidence that a
code URL resolves** — those are two different facts, and only the second decides whether a head-to-head can be
run. Three of the five defects are exactly that collapse, at three different depths.

## The inventory

Every artefact token `sota-comparison.md` names — an `arXiv:` identifier, a `github.com/OWNER/REPO` URL, a
`10.…/zenodo.…` DOI, or a backticked `OWNER/REPO` that is not a path into this repository. The population is
**22 tokens**, and the fence in
`packages/kinetic/__tests__/unit/competitor-artefact-availability.test.ts` requires every one of them to have
exactly one row here.

| token | verdict | what the artefact is | verified |
| --- | --- | --- | --- |
| `github.com/cruiseresearchgroup/DecompRCA` | **NOT-RESOLVABLE** | GitHub `GET /repos/cruiseresearchgroup/DecompRCA` → **404**, and `search/repositories?q=DecompRCA` → `total_count 0`. The organisation exists (115 public repos) and does not hold it | 2026-10-13, GitHub API |
| `arXiv:2609.36686` | **NOT-RESOLVABLE** | *Where Root Cause Analysis Fails* (NeurIPS 2026 E&D). Its own abstract says "Code is available at …/DecompRCA" — **the URL it names is the one that 404s** | 2026-10-13, arXiv abstract page + GitHub API |
| `arXiv:2608.08968` | **RESOLVES-WITHOUT-METHOD** | GALA+ (ASE'26). `github.com/EvanTian233/GALA-for-RCA` resolves (MIT, 286 files) and its README says the implementation *"was developed under a collaborative research agreement with our industrial partner, whose terms **preclude public release of the source code**"*. It ships the supplementary report, an annotated dataset, sample outputs and **third-party baselines** | 2026-10-13, GitHub API + README |
| `arXiv:2508.12472` | **RESOLVES-WITHOUT-METHOD** | The prior GALA paper. The same repository is the only GALA artefact on GitHub (`search?q=gala root cause analysis microservices` → 1, that repo), and it holds no method code for either paper | 2026-10-13, GitHub API |
| `github.com/EvanTian233/GALA-for-RCA` | **RESOLVES-WITHOUT-METHOD** | The GALA repository. 200, MIT, `main`, pushed 2026-07-28, 286 files, and its README's own *Implementation Availability* section says the software *"was developed under a collaborative research agreement with our industrial partner, whose terms preclude public release of the source code"*. It ships `techinical_report.pdf`, `data/annotated_dataset.csv`, `sample_output/` and `baselines/` — **third-party** frameworks, which is what a reader would mistake for the method | 2026-10-13, GitHub API + README |
| `10.5281/zenodo.22832168` | **RESOLVES-WITH-METHOD** | PSC-GRCA — Zenodo record 22832168, Buljić (University of Zenica), published 2026-09-18, with a **Files** section: code, seed manifests, the 62-entry defect register, table-generating scripts | 2026-10-13, DOI resolution |
| `github.com/Musfiqshohan/RCA-DCM` | **RESOLVES-WITH-METHOD, NO LICENCE** | RCA-DCM. 200; Python; `dcm/`, `examples/`, `run_sink_graph.py`, `score_sink.py`, and `baselines/RCAEval` vendored. `license` reads **`None`** — the artefact is readable and gives no grant of rights | 2026-10-13, GitHub API |
| `arXiv:2609.36771` | **RESOLVES-WITH-METHOD, NO LICENCE** | RCA-DCM — the same artefact as above | 2026-10-13, GitHub API |
| `edgedelta/project-arena` | **RESOLVES-WITH-METHOD** | Project Arena (Edge Delta, 2026-10-08). 200, MIT, `master`, pushed 2026-10-02 | 2026-10-13, GitHub API |
| `arXiv:2610.05009` | **NO-ARTEFACT** | Huawei + Tsinghua tool-design study. Our record already states it ships no code, weights or dataset link — a NEGATIVE claim, and it stands | 2026-10-11 and 2026-10-13, paper text |
| `arXiv:2601.21359` `arXiv:2310.16340` `arXiv:2404.12135` `arXiv:2510.04711` `arXiv:2510.22613` `arXiv:2605.14866` `arXiv:2606.05636` `arXiv:2606.27154` `arXiv:2607.28545` `arXiv:2608.25661` `arXiv:2609.19825` `arXiv:2609.27069` `arXiv:2610.08622` | **NO-CLAIM** | Our record makes **no availability claim** about these. `NO-CLAIM` is a fact about this document, not about the paper: it means nothing here was read and nothing here may be inferred | 2026-10-13, record makes no availability claim |

## The five defects

**D1 — a plan-restricting fact, inferred from a statement and never checked.** Two sentences in
`sota-comparison.md` assert DecompRCA's code is public — *"Its code is public (`…/DecompRCA`), so the
comparison is available to run"* (entry 4) and *"…nor the fact that its code is public at `…/DecompRCA`"*
(§0e) — and the URL 404s. **The second sentence is the sharper one**: it corrects a survey for *omitting* a
fact that is not true. A correction that propagates an unchecked claim is worse than the omission it fixes.

**D2 — the artefact that would matter most had no URL at all, and when found it does not carry the method.**
§0b/§0e say GALA+ *"sits here with the number recorded and **the comparison left runnable**"*, naming no
artefact. `EvanTian233/GALA-for-RCA` is findable, resolves and is MIT — and its README withholds the
implementation. Its top level contains `baselines/`, `data/` and `sample_output`, which is exactly the shape a
reader would take for "the code is public": **the trap is a repository that looks like the method and is not.**

**D3 — four availability claims name no artefact.** The sentence-level check in the fence reports four
sentences that claim availability or runnability while naming no artefact at all: Project Arena's *"the code,
the reproduction commands and the `examples/results/` case tables are public"*; the prior GALA paper's
*"…and run their code on ours"*; GALA+'s *"the comparison left runnable"*; and §2b-ii's *"run their code on
ours — the five reproducible references have all been reproducible and none has been run"*. In each the
artefact is one paragraph away, or nowhere, and a reader cannot act on the claim.

**D4 — the count is false and is a plan.** "The five reproducible references have all been reproducible" is
refuted by D1: at least one of them does not resolve. The count also has no derivable membership — which five,
by what test — so a change to any one of them cannot fail anything.

**D5 — two artefacts that MATTER more were never looked for.** `RCA-DCM` is the only reference on our metric
(Top-1) and on the same two systems, and the record carries its URL but never established that it resolves or
that it is unlicensed. `GALA-for-RCA` is the only named competitor with a number on RE2-TrainTicket, the one
cell where we are behind. **The record knew which two comparisons would decide a standing, claimed one was
runnable, and had not looked at either.**

## What the roadmap does with this

The `−2.2pp` on RE2-TrainTicket cannot be closed by running GALA+'s code, and it cannot be closed by running
DecompRCA's. **Both routes in the previous `NEXT` list are closed by this document** — not by a measurement
that failed, but by an artefact that is not there. What remains, in order:

1. **RCA-DCM is the runnable one on our metric and our systems** — 384 files, its own `dcm/` package, RCAEval
   baselines vendored — and it reports the numbers we can be head-to-head against (**0.880 SockShop / 0.776
   OnlineBoutique** against our published **92.8 / 92.2** and **86.7 / 80.0**). It is unlicensed, which is a
   fact to state rather than a blocker for a private comparison.
2. **PSC-GRCA's `Avg@5` 0.915 is the other runnable one**, with seeds and table-generating scripts, and it is
   on a metric we do not headline.
3. **The PRISM precedent is the fallback for the rest**: PRISM shipped no artefact we could find either, and
   the comparison that matters most in this record — `78.91 vs 78.75` over the identical 735 — is a
   **reimplementation inside this repository**. A citation is not closed by waiting for someone else's code.
4. And the two things the paper *does* publish are still worth taking without its code: the **retrieval/rerank
   decomposition** (`arXiv:2609.36686`'s instrument, already saturated here) and its **multi-signal retriever**
   — magnitude, **earliest onset**, **discrete state-change** — of which the third is the one this repository
   has never wired as a retrieval signal.
