/**
 * The corpus census: every path that builds an RCAEval corpus, and the ONE owner that assembles it.
 *
 * ## The defect
 *
 * The corpus an RCAEval case presents to the engine is not just its metrics — it is the metrics, a call graph
 * **augmented from the case's own observed spans**, the two direction-carrying inputs, and (on RE3) the
 * per-service span-activity counts. **Four files assembled it, and they did not agree:**
 *
 * | path | augmentation | `failedTraceEdges` | `edgeLatency` |
 * | --- | --- | --- | --- |
 * | `run-rcaeval.ts` (the published cells) | `{ minCallFrequency: 1 }` | streaming pass over `traces.csv` | the capped span list |
 * | `run-ablation.ts` (the ledger) | **none** | streaming pass | streaming pass |
 * | `run-optimize.ts` (the weight search) | `{ minCallFrequency: 1 }` | **the capped span list** | the capped span list |
 *
 * So the published cells ranked on the pruned graph, the study on the unpruned one, and the search on a graph
 * whose failed-edge input was a **truncation** of the shipped one. The golden's own artifact states the size of
 * the step two of the three were taking or not taking: `50/50 cases with traces, 50 pruned, avg edges: 20 → 9`
 * (RE2 OB), `218 → 39` (RE2 TT), `23 → 9` (RE3 OB), `218 → 41` (RE3 TT).
 *
 * **The measured cost was one cell in fourteen** — RE2 TrainTicket, +1.8pp in the unpruned direction — with the
 * other thirteen identical per fault type. Small, and beside the point: which graph a run ranks on was a
 * property of *which runner was invoked*. That is the same failure this repository has now repaired for
 * three quantities, and it is the register's own law — *a quantity with N implementations is a quantity with
 * no convention.*
 *
 * ## What this fence holds
 *
 * Source-shape, because the runners call `main()` at import time and are importable by nothing. The two
 * assertions that matter are an ABSENCE (no RCAEval assembler reaches the loader's conversion or the
 * augmenter directly) and an EXACT SET (the paths that legitimately do not use the owner, so it cannot grow
 * silently).
 *
 * @module benchmarks/__tests__/corpus-assembly
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src');

const read = (name: string): string => readFileSync(resolve(SRC, name), 'utf8');
const sources = readdirSync(SRC).filter((n) => n.endsWith('.ts'));

/** The three paths that build their corpus from `RCAEvalLoader` cases plus a `traces.csv`. */
const RCAEVAL_ASSEMBLERS = ['run-rcaeval.ts', 'run-ablation.ts', 'run-optimize.ts'] as const;

/**
 * The paths that build a corpus and do NOT go through this owner, and why each is legitimate. An exact set
 * rather than an exclusion: a set that grows without a note is a set nobody can audit, and this is the list a
 * reviewer must empty or extend deliberately.
 */
const NOT_THE_RCAEVAL_CORPUS: readonly string[] = [
  // A different loader and a different case format (`case.json`), with no span data at all — the FSE'26 half
  // has never had a trace-topology step to share, which is itself the reason its corpus must be re-checked
  // before any augmentation is enrolled there.
  'run-fse26.ts',
  // Synthetic cases built by `generateCase`: there are no traces, so there is nothing to assemble.
  'run-local-bench.ts',
];

describe('the corpus has one owner, and four paths used to assemble it', () => {
  it('routes every RCAEval assembler through the owner, and reaches the loader or augmenter nowhere else', () => {
    // The ABSENCE half. A new `loader.toBenchmarkCase(...)` or `augmentTopologyWithTraces(...)` in a runner
    // is the fifth implementation, and this is the assertion that fails when one appears.
    for (const name of sources) {
      if (name === 'rcaeval-corpus.ts') continue;
      const text = read(name);
      // The RCAEval conversion is the THREE-argument one (`case, graph, suiteName`). The FSE'26 loader's
      // `toBenchmarkCase(raw)` is a different loader over a different corpus, so the assertion is scoped to
      // the signature that carries an assembled graph.
      expect(text, `${name} must not convert a raw case itself`).not.toMatch(
        /\.toBenchmarkCase\([^)]*,\s*[a-zA-Z]/,
      );
      expect(text, `${name} must not augment a graph itself`).not.toContain(
        'augmentTopologyWithTraces(',
      );
    }
  });

  it('names the runners that build a corpus outside it, so the set cannot grow silently', () => {
    const outsiders = sources.filter((name) => {
      if (name === 'rcaeval-corpus.ts') return false;
      const text = read(name);
      // A corpus builder is a file that LOADS a case (or synthesises one) and does NOT go through the owner.
      // A helper that merely builds a graph is not one, which is why `rcaeval-topology.ts` is absent from this
      // list rather than excused in it — and the three assemblers are absent because they DO call the owner,
      // not because they were enumerated here.
      return /\.loadCase\(|generateCase\(/.test(text) && !text.includes('assembleRCAEvalCase(');
    });
    expect(outsiders.sort()).toEqual([...NOT_THE_RCAEVAL_CORPUS].sort());
  });

  it('has all three assemblers augment, because the published cells are the augmented corpus', () => {
    // The parity itself. `false` here is a run that ranks on a graph the published nine do not — which is
    // exactly what the study did before this, and it is why its RE2 TrainTicket cell read 69.9 against 68.1.
    for (const name of RCAEVAL_ASSEMBLERS) {
      const text = read(name);
      expect(text, `${name} calls the owner`).toContain('assembleRCAEvalCase(');
      expect(text, `${name} augments`).toContain('augmentFromTraces: true');
    }
  });

  it('states the shipped augmentation once, as a value rather than as two omitted arguments', () => {
    const owner = read('rcaeval-corpus.ts');
    expect(owner).toContain('export const SHIPPED_TRACE_AUGMENTATION');
    expect(owner).toMatch(/SHIPPED_TRACE_AUGMENTATION = \{ minCallFrequency: 1 \}/);
    // Used at the one call site, so the threshold is a constant and not a literal twice.
    expect(owner).toMatch(/augmentTopologyWithTraces\(graph, spans, SHIPPED_TRACE_AUGMENTATION\)/);
  });

  it('keeps the corpus OUT of the feature flags, which is the mistake that hid it for three iterations', () => {
    // A corpus property expressed as a ranking flag is a property with two owners and no statement about
    // which corpus a run used. The flag that did this was named `traceAugmentation` — the SHIPPED step's own
    // name — while its arm was `{ minCallFrequency: 0, discoverNewEdges: false, pruneUnobserved: true }`, a
    // third augmentation; it measured `+0.0` on RE2 and RE3, the only suites that have traces.
    const owner = read('rcaeval-corpus.ts');
    // The gate is the CALLER's declared option, asserted positively — a token absence would also be satisfied
    // by prose that merely discusses flags, and would be silent about the option ceasing to be the gate.
    expect(owner, 'the augmentation is gated on the caller option').toMatch(
      /if \(options\.augmentFromTraces\)/,
    );
    expect(owner, 'the owner takes no feature-flag type').not.toContain('FeatureFlags');
    expect(owner).not.toContain('extraTraceValidation');
    // Scoped to IDENTIFIER positions. Prose is allowed to name the retired flag — that is how a reader learns
    // what it was called — but no file may still USE it, as a member, a key or an access.
    for (const name of sources) {
      expect(read(name), `${name} still advertises the shipped step as a flag`).not.toMatch(
        /[.']traceAugmentation|traceAugmentation\s*[:?,)]/,
      );
    }
  });

  it('derives the two direction fields from different inputs, and says so', () => {
    // Not a tidiness defect to be fixed: `latWeight` multiplies the capped-span `edgeLatency`, so unifying the
    // two derivations would move a published number. The owner reproduces the composition and records why.
    const owner = read('rcaeval-corpus.ts');
    expect(owner).toContain('countDirectionalInputs(');
    expect(owner).toMatch(/failedTraceEdges: streaming\.failedTraceEdges/);
    expect(owner).toContain('deliberately NOT re-derived');
  });
});
