/**
 * The FSE'26 half of the label prior: where its history comes from, and what the gate could see.
 *
 * The term's arithmetic is pinned in `packages/tree/__tests__/unit/label-prior.test.ts`, and the POOLING rule
 * (one incident, one answer, leave-one-out) in `label-prior-profiles.test.ts`. What is pinned here is the third
 * thing a cell table cannot audit: that this runner's history is derived from the corpus it is scoring, by a
 * reader that agrees with the loader about every label, and that the gate's reach over that corpus is a
 * measurement rather than an assumption.
 *
 * ## Why the reader is not the loader
 *
 * A case's `case.json` is ~22 MB and the label is the fourth key of a one-line object. Parsing the file to read
 * it costs the corpus a full pass — 38 GB over the 1,422 datapacks, which is the whole scoring run's cost again
 * — to recover four kilobytes of strings. The fast path reads a prefix and parses the array it finds; the
 * fallback is a full `JSON.parse`, and the two are asserted to agree on the SAME file rather than on two whose
 * agreement was arranged.
 *
 * @module __tests__/fse26-label-history
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildCorpusLabelHistory,
  FSE26_DEPLOYMENT,
  priorForCase,
  readAcceptedFromCaseFile,
} from '../src/fse26-label-history.js';
import {
  formatPriorReach,
  parsePriorReachArgs,
  summarisePriorReach,
} from '../src/label-prior-reach.js';
import type { ParsedTermCase } from '../src/terms-dump.js';

/** Every file a test writes, so a failing assertion cannot leak a directory into the next one. */
const written: string[] = [];

afterEach(() => {
  written.length = 0;
});

/**
 * Write one case-shaped `case.json` inside a fresh directory, and return the DIRECTORY.
 *
 * The directory is the unit both callers take: `discoverCaseDirs` publishes directories, and the history builder
 * joins the marker onto each one. Returning the file path here made every history test pass for the wrong
 * reason — a directory that does not exist reads as an unreadable case.
 *
 * The shape is the converter's own, key order included: `datapack`, `faultType`, `faultCategory`,
 * `groundTruthServices`, `injectTimeMs`, `metrics`. The order is what the fast path relies on, so a fixture
 * that reordered it would test the fallback while claiming to test the reader.
 *
 * @param body - The file's contents.
 * @returns The case directory.
 */
function caseFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fse26-label-'));
  writeFileSync(join(dir, 'case.json'), body);
  written.push(dir);
  return dir;
}

/**
 * The file inside a case directory.
 *
 * @param dir - A directory {@link caseFile} produced.
 * @returns The path the reader takes.
 */
function casePath(dir: string): string {
  return join(dir, 'case.json');
}

/**
 * One case whose label sits at byte `offset` of the file.
 *
 * @param services - The accepted answers.
 * @param offset - Bytes of padding to place BEFORE the label, to push it past a prefix reader's window.
 * @returns The case directory.
 */
function caseJson(services: readonly string[], offset = 0): string {
  const pad = offset === 0 ? '' : `"padding":"${'x'.repeat(offset)}",`;
  return caseFile(
    `{"datapack":"ts0-mysql-corrupt-abc123",${pad}"faultType":"NetworkCorrupt",` +
      `"faultCategory":"Network","groundTruthServices":${JSON.stringify(services)},` +
      `"injectTimeMs":1755080248000,"metrics":{}}`,
  );
}

describe('readAcceptedFromCaseFile', () => {
  it('reads the accepted answers of a converter-shaped case', () => {
    expect(readAcceptedFromCaseFile(casePath(caseJson(['mysql', 'ts-order-service'])))).toEqual([
      'mysql',
      'ts-order-service',
    ]);
  });

  it('reads a single-label case as a one-element list rather than as a string', () => {
    // The corpus's ground truth is a SET for edge-shaped faults and a singleton otherwise, and the runner scores
    // against it as a list. A reader that answered the raw value would score `mysql` as five candidates.
    expect(readAcceptedFromCaseFile(casePath(caseJson(['mysql'])))).toEqual(['mysql']);
  });

  it('reads an empty label list as empty rather than as an absent field', () => {
    // A case the corpus labels with nothing is a fact about the corpus (`buildCorpusLabelHistory` skips it), not
    // a parse failure — and the two must not be the same return value.
    expect(readAcceptedFromCaseFile(casePath(caseJson([])))).toEqual([]);
  });

  it('finds the label beyond the prefix window by falling back to a full parse', () => {
    // The fast path reads a bounded prefix. A file whose label sits past it is a file the reader must still
    // answer, because the alternative is a silently empty history for that case — which would read as "the
    // deployment never diagnosed anything here" rather than as a missed read.
    expect(readAcceptedFromCaseFile(casePath(caseJson(['mysql'], 65_536)))).toEqual(['mysql']);
  });

  it('keeps a service name containing a bracket inside one element', () => {
    // The scanner walks for the closing bracket, and a name is free-form text in the schema. A `]` inside a
    // string that ended the scan would split one label into two candidates that neither the corpus nor the
    // engine has.
    expect(readAcceptedFromCaseFile(casePath(caseJson(['svc[0]', 'other'])))).toEqual([
      'svc[0]',
      'other',
    ]);
  });

  it('refuses a file whose label field is not an array', () => {
    // A coercion here would put a bare string into the history as if it were a list of incidents. The corpus is
    // machine-generated, so this is a schema violation and not a corpus shape.
    const dir = caseFile('{"groundTruthServices":"mysql"}');
    expect(() => readAcceptedFromCaseFile(casePath(dir))).toThrow(/groundTruthServices/);
  });
});

describe('buildCorpusLabelHistory', () => {
  it('counts the corpus once per incident, against the PRIMARY label', () => {
    // The rule `label-prior-profiles.ts` states: an edge-shaped fault has two accepted answers and one incident.
    // Counting it twice would make the history larger than the number of incidents it holds, which is the
    // denominator `p` divides by.
    const history = buildCorpusLabelHistory([
      caseJson(['mysql', 'ts-order-service']),
      caseJson(['mysql']),
    ]);
    expect(history.history.counts.get('mysql')).toBe(2);
    expect(history.history.counts.get('ts-order-service')).toBeUndefined();
    expect(history.history.labelled).toBe(2);
  });

  it('pools every case into ONE deployment, because the corpus is one system', () => {
    // Unlike RCAEval's nine cells, RCABench's 1,422 datapacks are all Train Ticket. A per-cell pool would make
    // the denominator a function of the fault type, which is the one split a prior over incidents may not use.
    const history = buildCorpusLabelHistory([caseJson(['mysql']), caseJson(['ts-train-service'])]);
    expect(history.deployment).toBe(FSE26_DEPLOYMENT);
    expect([...history.history.counts.keys()].sort()).toEqual(['mysql', 'ts-train-service']);
  });

  it('skips an unlabelled case instead of counting it as a zero', () => {
    const history = buildCorpusLabelHistory([caseJson([]), caseJson(['mysql'])]);
    expect(history.history.labelled).toBe(1);
    expect(history.unreadable).toBe(0);
  });

  it('counts an unreadable case rather than failing the run over it', () => {
    // The scoring loop already tolerates a load error (`loadErrors`) and continues. A history pass that threw
    // would turn one corrupt datapack into a run that produced no artifact at all — and the count is what stops
    // the tolerance from being silent.
    const history = buildCorpusLabelHistory([caseJson(['mysql']), caseFile('not json')]);
    expect(history.history.labelled).toBe(1);
    expect(history.unreadable).toBe(1);
  });

  it('reports a corpus with no labels at all as an empty history rather than throwing', () => {
    const history = buildCorpusLabelHistory([caseJson([])]);
    expect(history.history.labelled).toBe(0);
    expect(history.history.counts.size).toBe(0);
  });
});

describe('priorForCase', () => {
  const history = buildCorpusLabelHistory([
    caseJson(['mysql']),
    caseJson(['mysql']),
    caseJson(['ts-train-service']),
  ]);

  it('removes the case being scored from its own history', () => {
    // The quantity the term estimates is "how often is this service the answer ELSEWHERE", and the whole
    // argument for the term being deployable rests on this subtraction.
    const prior = priorForCase(history, ['mysql']);
    expect(prior.counts.get('mysql')).toBe(1);
    expect(prior.labelled).toBe(2);
  });

  it('deletes the entry when the case was its service’s only incident', () => {
    const prior = priorForCase(history, ['ts-train-service']);
    expect(prior.counts.has('ts-train-service')).toBe(false);
    expect(prior.labelled).toBe(2);
  });

  it('leaves the history whole when the corpus labelled the case with nothing', () => {
    // A case with no accepted answer is not an incident anyone diagnosed, so it removes nothing. The engine
    // reads `labelled` as the denominator, and subtracting a case the history never held would shrink it.
    const prior = priorForCase(history, []);
    expect(prior.labelled).toBe(3);
    expect(prior.counts.get('mysql')).toBe(2);
  });
});

describe('summarisePriorReach', () => {
  /**
   * One case at a chosen base margin and a chosen prior slope advantage.
   *
   * The dump's `score` is the engine's total, so the base is `score − weight × slope` — the reconstruction a
   * reader performs, and the reason the gate is checkable from the artifact instead of from a second run.
   *
   * @param margin - The base top-1 minus base top-2.
   * @param headBias - How much MORE likely the head is than the runner-up, in log-probability.
   * @returns A parsed dump case.
   */
  function oneCase(margin: number, headBias = 0): ParsedTermCase {
    const weight = 0.1;
    // The runner-up's base is ZERO and the head's is exactly `margin`, so the reconstructed gap is the fixture's
    // own number to the last bit rather than to within floating-point cancellation.
    const head = margin + weight * headBias;
    return {
      datapack: 'case',
      faultType: 'NetworkCorrupt',
      accepted: ['a'],
      candidates: [
        {
          id: 'a',
          score: head,
          terms: [
            ['selfAnomalyLog1p', 1, margin],
            ['labelPrior', weight, headBias],
          ],
        },
        {
          id: 'b',
          score: 0,
          terms: [
            ['selfAnomalyLog1p', 1, 0],
            ['labelPrior', weight, 0],
          ],
        },
      ],
    };
  }

  it('reads the gate’s input from the artifact: the BASE margin, before the prior is added', () => {
    // The defect this rules out is the one the gate exists to avoid — a threshold read off the score the term
    // itself moved. The base is reconstructed by subtracting the term, so the number the census reports is the
    // number the engine compared.
    const reach = summarisePriorReach([oneCase(0.5, 3)], 0.02);
    expect(reach.cases).toBe(1);
    expect(reach.admitted).toBe(1);
    expect(reach.medianBaseMargin).toBeCloseTo(0.5, 12);
  });

  it('withholds a case whose head is separated by less than the gate', () => {
    const reach = summarisePriorReach([oneCase(0.01, 3)], 0.02);
    expect(reach.admitted).toBe(0);
    expect(reach.withheld).toBe(1);
  });

  it('admits a case exactly AT the gate, on the engine’s strict-inclusive comparison', () => {
    // `topTwoGap(...) >= labelPriorMarginGate` — the engine's own operator, asserted here so the census cannot
    // report a different population than the term acted on.
    expect(summarisePriorReach([oneCase(0.02)], 0.02).admitted).toBe(1);
  });

  it('reports the quantiles the gate is chosen against, over the corpus rather than over one case', () => {
    const cases = [0.001, 0.01, 0.02, 0.05, 0.5].map((margin) => oneCase(margin));
    const reach = summarisePriorReach(cases, 0.02);
    expect(reach.cases).toBe(5);
    expect(reach.admitted).toBe(3);
    expect(reach.medianBaseMargin).toBeCloseTo(0.02, 12);
  });

  it('counts a case with no candidate pair as neither admitted nor withheld', () => {
    // A degenerate case (one candidate, or a graph the engine could not score) has no margin at all. Folding it
    // into `withheld` would report the gate as the reason a case the gate never saw produced no movement.
    const single: ParsedTermCase = {
      datapack: 'single',
      faultType: 'NetworkCorrupt',
      accepted: ['a'],
      candidates: [{ id: 'a', score: 1, terms: [['selfAnomalyLog1p', 1, 1]] }],
    };
    const reach = summarisePriorReach([single], 0.02);
    expect(reach.cases).toBe(1);
    expect(reach.admitted).toBe(0);
    expect(reach.withheld).toBe(0);
    expect(reach.unmeasurable).toBe(1);
  });

  it('counts a case the run scored without carrying the term as unmeasurable, not as withheld', () => {
    // The shipped configuration (`labelPriorWeight = 0`) writes no slope, and `null` is not a measured zero. A
    // census over it must say "this run could not have shown me", which is a statement about the artifact.
    const bare: ParsedTermCase = {
      datapack: 'bare',
      faultType: 'NetworkCorrupt',
      accepted: ['a'],
      candidates: [
        {
          id: 'a',
          score: 2,
          terms: [
            ['selfAnomalyLog1p', 1, 2],
            ['labelPrior', 0, null],
          ],
        },
        {
          id: 'b',
          score: 1,
          terms: [
            ['selfAnomalyLog1p', 1, 1],
            ['labelPrior', 0, null],
          ],
        },
      ],
    };
    const reach = summarisePriorReach([bare], 0.02);
    expect(reach.unmeasurable).toBe(1);
    expect(reach.admitted).toBe(0);
    expect(reach.withheld).toBe(0);
  });
});

describe('the census command line', () => {
  it('takes the dump and the gate it must report against', () => {
    expect(parsePriorReachArgs(['--terms', 'dump.ndjson', '--gate', '0.02'])).toEqual({
      terms: 'dump.ndjson',
      gate: 0.02,
    });
  });

  it('refuses to guess a gate', () => {
    // A default here would publish a census about a threshold the run may not have used — the artifact's own
    // config line is where the gate comes from, and a tool that supplied one would be a second owner of it.
    expect(() => parsePriorReachArgs(['--terms', 'dump.ndjson'])).toThrow(/--gate/);
    expect(() => parsePriorReachArgs(['--terms', 'dump.ndjson', '--gate', '-1'])).toThrow(/--gate/);
    expect(() => parsePriorReachArgs(['--terms', 'dump.ndjson', '--gate', 'abc'])).toThrow(
      /--gate/,
    );
  });

  it('requires the dump rather than reading a default path', () => {
    expect(() => parsePriorReachArgs(['--gate', '0.02'])).toThrow(/--terms/);
  });

  it('refuses an argument it does not know, rather than skipping it', () => {
    expect(() => parsePriorReachArgs(['--term', 'dump.ndjson'])).toThrow(/unknown argument/);
  });
});

describe('formatPriorReach', () => {
  it('names the population beside the numbers, and the median the gate was chosen against', () => {
    const line = formatPriorReach({
      gate: 0.02,
      cases: 4,
      admitted: 3,
      withheld: 1,
      unmeasurable: 0,
      medianBaseMargin: 0.1234,
    });
    expect(line).toContain('gate=0.02');
    expect(line).toContain('admitted=3 (75.0%)');
    expect(line).toContain('withheld=1 (25.0%)');
    expect(line).toContain('median base margin=0.1234');
  });

  it('says n/a rather than 0.0% when the gate had nothing to compare', () => {
    // A share over an empty denominator is not zero — it is undefined, and `0.0 %` would read as "the gate
    // withheld everything" when the truth is that the run never armed the term.
    const line = formatPriorReach({
      gate: 0.02,
      cases: 1,
      admitted: 0,
      withheld: 0,
      unmeasurable: 1,
      medianBaseMargin: 0,
    });
    expect(line).toContain('(n/a)');
  });
});
