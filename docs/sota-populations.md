# SOTA populations — which population each reference reports on, and who owns that fact

## Why this document exists

Three iterations carried this sentence in `sota-comparison.md` §0a:

> **Filed as a CANDIDATE ABOVE US WHOSE POPULATION IS NOT VERIFIED** … `375 = 3 × 125` is RE1's signature
> (RE2 is 270, RE3 is 90, FSE'26 is 1430) … **so if the cohort is RCAEval's RE1, this would be the first
> reference to exceed our 80.27% on a population we can name**, by **5.1pp**.

**The reading it was waiting for took one fetch.** The paper's own full text evaluates *"the three RCAEval
diagnostic environments"*, and the authors' own project page names *"RCAEval RE1 failure cases (375)"* — so the
population is ours, the gap is real, and it is quoted now (+5.13pp at `L0`, +2.53pp at `L3`, against our 80.27%
on RE1). What three iterations had instead was a **shape match** — a case COUNT and a metric NAME agreeing with
ours — which is the strongest thing those two facts can establish and is not a population.

The register's law 10 says **a paper's own artefact statement is the authority on whether its artefact is
public.** This document is that law's corollary, one surface over, and it is now the register's law 37:

> **The artefact that states a paper's population is its own full text or its own project page; a search of its
> abstract cannot settle it.**

Both searches the record ran were abstract searches, and the population is in neither the abstract nor any index
of it. This is iteration 99's finding — *a plan-restricting fact must be resolved, not transcribed* — arriving at
the same place from the population side, which is why the two are one law with two names rather than two laws.

## The three verdicts

| verdict | what it means | what a reader may do with it |
| --- | --- | --- |
| `OURS` | the reference reports on a population that **is** one of ours — RCAEval RE1 (375), RE2 (270, or 90 per system), RE3 (90), FSE'26 RCABench (1422), or a named slice of them, under a metric we headline | quote a gap, in either direction, with the population named beside it |
| `OTHER` | the reference reports on a named population that is **not** ours — another benchmark, another split, another unit, or a mixture | its number is recorded and **no gap may be read from it** |
| `UNVERIFIED` | our record **cannot place** the population, and the next paragraph says which artefact would place it | nothing may be inferred; the row is a work item, not a shrug |

## The inventory

Every artefact token `sota-comparison.md` names — an `arXiv:` identifier, a `github.com/OWNER/REPO` URL, an
`OWNER.github.io/…` project page, a `10.…/zenodo.…` DOI, or a backticked `OWNER/REPO` that is not a path into
this repository — is **24 tokens as of 2026-10-14**, and the fence in
`packages/kinetic/__tests__/unit/sota-population-claims.test.ts` requires every one of them to have exactly one
row here. (The prose in `competitor-artefact-availability.md` said 22 while the tree it described named 23; the
one it was short of, and the project page added here, are both recorded rather than quietly counted again.)

| token | verdict | the population it reports on | verified |
| --- | --- | --- | --- |
| `arXiv:2610.05009` | **OURS** | **RCAEval RE1 — 375 = 3 × 125 (OnlineBoutique, SockShop, TrainTicket)**, service `top-1`. Its own full text: *"the three RCAEval diagnostic environments"*; its own project page: *"RCAEval RE1 failure cases (375)"* | 2026-10-14, arXiv HTML full text + the authors' own project page |
| `luoyu100.github.io/projects/toolrca/project` | **OURS** | the project page of the entry above. It **resolves** and names *"RCAEval RE1 failure cases (375)"*, so it is what the population verdict rests on | 2026-10-14, project page |
| `arXiv:2609.36771` | **OURS** | RE1 SockShop / OnlineBoutique, **125 cases each**, service Top-1 | 2026-10-10, paper text + `github.com/Musfiqshohan/RCA-DCM` |
| `github.com/Musfiqshohan/RCA-DCM` | **OURS** | the artefact of the row above; its README states the two systems' shared five-fault composition, which is what fixes 125 | 2026-10-13, GitHub API + README |
| `arXiv:2601.21359` | **OURS** | **RCAEval all 735 cases**, service Top-1 — the benchmark author's own method | 2026-10-13, paper text; and our reimplementation on the identical 735 (`prism-head-to-head.md`) |
| `arXiv:2605.14866` | **UNVERIFIED** | `RCLAgent`, listed in our §2b table at `AC@1 56.67%` / `52.31%` on RE2-OnlineBoutique. **Our only basis is our own table** — the paper was never read for its population, and it also reports AIOPS-2022 (`65.15%`) and an augmented TrainTicket, so more than one population is in play. **Resolution artefact: the paper's own full text** | 2026-10-14, §2b of `sota-comparison.md` — which is the claim, not the reading |
| `arXiv:2310.16340` | **UNVERIFIED** | `RCAgent`, the same shape as the row above: our §2b table places it on RE2-OB at `25.32%`, and **an independent 2026 baseline table places it on AIOPS-2022 (`22.10%` / `24.80%`) and a private production dataset instead.** The two readings disagree and neither is the paper's own statement of its population. **Resolution artefact: the paper's own full text** | 2026-10-14, §2b of `sota-comparison.md` + an independent 2026 baseline table |
| `arXiv:2404.12135` | **UNVERIFIED** | `mABC`, the same shape again: our §2b table places it on RE2-OB at `39.98%`, and the same independent table places it on AIOPS-2022 (`34.19%`) and a private production dataset. **Resolution artefact: the paper's own full text** | 2026-10-14, §2b of `sota-comparison.md` + an independent 2026 baseline table |
| `arXiv:2508.12472` | **OURS** | RE2-OnlineBoutique, **90 injected-fault scenarios**, `AC@1` / `Avg@3` / `Avg@5` — its own text: *"We choose the RE2-OnlineBoutique (OB) dataset from the RCAEval benchmark"*, and the 90 is read off its own *"each service–fault combination was executed in three independent rounds, yielding 90 distinct incidents"* | 2026-10-14, arXiv HTML full text |
| `arXiv:2608.08968` | **OURS** | **RE2, 90 cases per system** — the population is read off its own `AC@3` (`98.89% = 89/90`, `85.56% = 77/90`) and its own text, which also names a third corpus (`AegisLab`, 100 sampled cases) that carries **no** figure of ours | 2026-10-14, arXiv HTML full text |
| `github.com/EvanTian233/GALA-for-RCA` | **OURS** | the artefact of the two GALA rows; it withholds the method and carries an annotated dataset for the same populations | 2026-10-13, GitHub API + README |
| `arXiv:2510.04711` | **OURS** | the **FSE'26 RCABench** fault set this repository leads by +16pp — the same 1422-case population our own published FSE'26 number is on | 2026-10-13, paper text |
| `arXiv:2609.27069` | **OTHER** | its own **six-fixed-fold split**, read under `Avg@5` — not our 375-case RE1 read under Top-1. Its `0.915` is the in-distribution mean; its cross-system number is `0.747` | 2026-10-10, paper's own tables; **re-read 2026-10-15**, which added its own WITHDRAWAL of every RE2 claim (*"an earlier PSC run labelled RE2 was scored on RE1 folds"*) and the seed spread its `0.915` sits in (0.914-0.928, mean 0.921) |
| `10.5281/zenodo.22832168` | **OTHER** | the artefact of the row above — same split, same metric | 2026-10-13, DOI resolution |
| `arXiv:2609.36686` | **OTHER** | **RCAEval *and* WADI / SWaT / HVAC** — the `+12pp` it is most quoted for is a **CPS** margin; what is comparable is the decomposition, not a gap | 2026-10-13, paper text + survey of its own data description |
| `github.com/cruiseresearchgroup/DecompRCA` | **OTHER** | the artefact the row above names, and it **404s** — so even the population it would be read on is unreachable | 2026-10-13, GitHub API |
| `arXiv:2606.27154` | **OTHER** | `PAVE` / OpenRCA 2.0 — **500 instances** on a step-wise-annotated corpus that is not ours; its `20.7%` exact-set recovery is the paper's own figure, not a top-1 | 2026-10-13, paper text |
| `arXiv:2609.19825` | **OTHER** | `EviRCA` — **OpenRCA**, Bank 136 / Telecom 51 / Market 148 = **335 cases**, under Correct/Partial rather than Top-1 | 2026-10-13, paper text |
| `arXiv:2510.22613` | **OTHER** | `DynaCausal` — mixed public benchmarks, **not RCAEval-only**, so no population of ours is a subset of it | 2026-10-13, §2c of `sota-comparison.md` |
| `arXiv:2607.28545` | **OTHER** | ORCA-bench — a fault-propagation-aware benchmark with its own agents' 25.3% Medium figure | 2026-10-13, §3 of `sota-comparison.md` |
| `edgedelta/project-arena` | **OTHER** | **21 injected scenarios** on OTel Demo under Kubernetes — a candidate INSTRUMENT, not a candidate number | 2026-10-13, GitHub API + the vendor's own page |
| `arXiv:2606.05636` | **OTHER** | `StableRCA`'s **77%** is Top-1 on **Sock-Shop `[soc, 2022]`** — a standalone corpus its own text lists **separately from RCAEval**, among *"five datasets across retail services, microservices, manufacturing, and physical systems"* (ProRCA, Sock-Shop, RCAEval, CausalMan, CausalChambers). **It is not RE1-SS** and its own text states no case count, so `77%` is not a number of ours and no gap may be read against our 92.8% | 2026-10-14, arXiv HTML full text |
| `arXiv:2608.25661` | **OTHER** | `OpsHarness`'s **59.0%** is *"top-1 accuracy on average across **four backbones**"* over **OpenRCA**, **RCAEval** *and* an industrial deployment. **RCAEval IS in the mix** — so our corpus is a COMPONENT of the figure and the figure is still not ours: a cross-backbone average over three populations with no per-population number. Below our 78.75% in any case | 2026-10-14, arXiv HTML full text |
| `arXiv:2610.08622` | **UNVERIFIED** | `E4`, *"a mix of synthetic and real-world workloads"* — no benchmark, no case set, and a **relative** `62%` against an unnamed baseline. **Resolution artefact: the paper's own full text** | 2026-10-14, §0a entry 6 of `sota-comparison.md` |

## What the verdicts change, stated rather than implied

**One standing moves.** `arXiv:2610.05009` was the only `UNVERIFIED` row whose resolution could change a RANK,
and it does: **RE1 is a cell we are now second on**, at −5.13pp (`L0`) and −2.53pp (`L3`) against our 80.27%.
That is recorded in `sota-comparison.md` §0's standing table, and the two figures travel with the paper's own
error bar — **its `L0`-against-`L3` ordering is under one standard deviation**, so the gap is quotable and the
ordering inside it is not.

**Two of the rows this inventory was created with are no longer unquotable, and both resolved to `OTHER`.** The
2026-10-14 pass read them from the papers' own full texts: **`StableRCA`'s 77% is on a Sock-Shop corpus its own
text lists separately from RCAEval** — so it was never our RE1-SS number — and **`OpsHarness`'s 59.0% is an
average across four backbones over OpenRCA, RCAEval and an industrial deployment**, so RCAEval is a component of
its figure and the figure is still not ours. Reading them changed no standing; it changed *"we have not read
this"* into *"we read it and it is not ours"*, which is the distinction this inventory exists to hold.

**And the three rows that remain `UNVERIFIED` are the §2b cohort** — `RCLAgent`, `RCAgent` and `mABC` — each of
which carries a number our own table asserts and no document of ours ever read. They are the inventory's next
readings.

**And the inventory is what makes the difference legible.** Before it, the difference between *"we have not read
this"* and *"we read it and it is not ours"* lived in whichever sentence a reader happened to open. Both are
negative and only one of them is a finding.

## What this document does not cover, stated rather than implied

- **It is not an availability inventory.** Whether an artefact RESOLVES, and what it carries, is owned by
  `docs/competitor-artefact-availability.md` — the same 24 tokens, the other question.
- **It does not resolve the three `UNVERIFIED` rows it still holds.** Each names the artefact that would, and
  reading them is work this document schedules rather than performs.
- **It does not fence the references' AFFILIATIONS.** The fifth entry's institution was stated in five places
  under two different attributions, and it is corrected in all five as part of this iteration — but no rule here
  can check one, because an affiliation is a fact about a paper that only the paper carries, and a rule that
  compared our prose to our prose would agree with itself. It is recorded as a finding, and the fifth entry now
  carries the authors' own three affiliations (Nankai, Huawei, Tsinghua) where it used to carry the two that
  omitted the seven-authors' institution.
