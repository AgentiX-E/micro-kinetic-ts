import { describe, expect, it } from 'vitest';

import {
  familyAblation,
  fidelityOf,
  formatAblation,
  parseAblationArgs,
  parseAblationDump,
  runAblation,
} from '../src/rcaeval-metric-ablation.js';

/**
 * A dump in the shape the runner actually writes, small enough to reason about.
 *
 * The blocks below are built from the artifact's own line grammar — the header, the service line with its
 * `[#k]` / `[GT,#k]` tag, and `metricTop(n)` — rather than from the tool's intermediate objects, so a change
 * to the grammar fails here instead of in a dispatch.
 */
const shape = (deviation: string, rise: string, base: string): string =>
  `{dev=${deviation},trend=0.000,cv=0.000,burst=0.000,rise=${rise},drop=0.10,base=${base}}`;

function service(
  name: string,
  tag: string,
  anomaly: string,
  metrics: readonly (readonly [string, string])[],
): string {
  const rendered = metrics.map(
    ([label, value]) => `${label}=${value}${shape('0.301', '2.00', '1.000e+0')}`,
  );
  return [
    `  ${name} [${tag}] selfAnomaly=${anomaly} logScore=0.000 failedEdge=0.000 dominant=${metrics[0]?.[0] ?? '-'} onset=0`,
    `    metrics(${metrics.length}): ${metrics.map(([label]) => label).join(',')}`,
    `    metricTop(${rendered.length}): ${rendered.join(' ')}`,
  ].join('\n');
}

function kase(
  datapack: string,
  faultType: string,
  truth: string,
  services: readonly string[],
): string {
  return [
    `DIAG datapack=${datapack} faultType=${faultType} GT=[${truth}] services=${services.length} logMode=count inject=0 decimals=3`,
    '  edges=a>b',
    ...services,
  ].join('\n');
}

/** The truth wins on `latency`; a bystander's `workload` is large but not large enough. */
const TRUTH_WINS = kase('d1', 'cpu', 'alpha', [
  service('alpha', 'GT,#1', '2.000', [
    ['latency', '2.000'],
    ['workload', '0.500'],
  ]),
  service('beta', '#2', '0.400', [['workload', '0.400']]),
]);

/** A bystander's `workload` outranks the truth: excluding the family moves the winner to the truth. */
const WORKLOAD_WINS = kase('d2', 'cpu', 'alpha', [
  service('alpha', 'GT,#2', '1.000', [
    ['latency', '1.000'],
    ['workload', '0.500'],
  ]),
  service('beta', '#1', '1.400', [['workload', '1.400']]),
]);

describe('parseAblationDump — the artifact’s own grammar, and nothing else', () => {
  it('reads the score and the rank the tag carries, in either spelling', () => {
    const [first] = parseAblationDump(TRUTH_WINS);
    // `[GT,#1]` and `[#2]` are the two tags the runner writes: a ground truth that is also rank-1, and a
    // service that is not. Reading only the second would lose the rank of every CORRECT case — which is
    // exactly the bug that made a first draft of this tool report a 25/125 fidelity on a perfect dump.
    expect(first!.services.map((svc) => [svc.name, svc.rank])).toEqual([
      ['alpha', 1],
      ['beta', 2],
    ]);
    expect(first!.services[0]!.anomaly).toBe(2);
    expect(first!.truths).toEqual(['alpha']);
    expect(first!.faultType).toBe('cpu');
  });

  it('takes the metric scores from `metricTop` and not from the decisive-metric line', () => {
    // The two lines carry the SAME metric in the same units, so a parser that read both would double-count
    // it and one that read the wrong one would report a single metric per service. The assertion is on the
    // population, not on a value: two metrics in, two metrics out.
    const [first] = parseAblationDump(TRUTH_WINS);
    expect([...first!.services[0]!.metrics]).toEqual([
      ['latency', 2],
      ['workload', 0.5],
    ]);
  });

  it('drops a case that names no root or printed no service, because neither has a subject to score', () => {
    const noTruth =
      'DIAG datapack=d9 faultType=cpu GT=[] services=0 logMode=count inject=0 decimals=3';
    const noServices =
      'DIAG datapack=d8 faultType=cpu GT=[alpha] services=1 logMode=count inject=0 decimals=3';
    expect(parseAblationDump(`${noTruth}\n${noServices}`)).toEqual([]);
  });

  it('ignores a service or metric line that precedes any header, rather than inventing a case', () => {
    // A dump is a report and a reader may hand it a fragment. A parser that attached these to the NEXT
    // header would give that case a service it never printed — the shape that makes a population larger
    // than the artifact.
    const stray = [
      service('ghost', '#9', '9.000', [['cpu', '9.000']]),
      '    metricTop(1): cpu=9.000' + shape('1.000', '1.00', '1.000e+0'),
      TRUTH_WINS,
    ].join('\n');
    const parsed = parseAblationDump(stray);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.datapack).toBe('d1');
    expect(parsed[0]!.services.map((svc) => svc.name)).toEqual(['alpha', 'beta']);
  });

  it('takes a tag with no rank as an unknown rank, which is what the tag says', () => {
    // The runner always writes `[#k]` or `[GT,#k]`, so this is a hand-built artifact — and the honest
    // reading of a tag without a number is `undefined`, not rank 0 or rank 1. A parser that defaulted to 1
    // would claim every unranked service was the engine's answer.
    const unranked = kase('d0', 'cpu', 'alpha', [
      service('alpha', 'GT', '1.000', [['cpu', '1.000']]),
      service('beta', '#2', '0.500', [['cpu', '0.500']]),
    ]);
    const [parsed] = parseAblationDump(unranked);
    expect(parsed!.services[0]!.rank).toBeUndefined();
    // …and a case whose only ranked service is missing one cannot be checked, so it is reported as a
    // disagreement rather than silently counted as agreement.
    expect(fidelityOf([parsed!]).agreed).toBe(0);
  });

  it('keeps a multi-truth case, and scores top-1 against the FIRST of them', () => {
    // The FSE'26 dumps name several roots; the ablation is a top-1 question, so the first is the one a
    // single-number hit is about. A parser that refused multi-truth headers would silently shrink the
    // population to the single-root cases.
    const multi =
      'DIAG datapack=d7 faultType=loss GT=[alpha,beta] services=1 logMode=count inject=0 decimals=3';
    const [parsed] = parseAblationDump(
      `${multi}\n${service('alpha', '#1', '1.000', [['cpu', '1.000']])}`,
    );
    expect(parsed!.truths).toEqual(['alpha', 'beta']);
  });
});

describe('fidelityOf — can the simulation speak about this dump?', () => {
  it('agrees when the maximum picks the service the engine ranked first', () => {
    const report = fidelityOf(parseAblationDump(TRUTH_WINS));
    expect(report).toEqual({ cases: 1, agreed: 1, mismatches: [] });
  });

  it('names the datapack when the maximum and the engine’s rank-1 DISAGREE', () => {
    // The disagreement is the whole reason the control exists: this fixture's rank-1 is `beta`, whose score
    // is the largest, so a faithful simulation agrees. Making the engine's own tag point at `alpha` is the
    // mutation — some other term moved the order, and the report must say WHICH case rather than a count.
    const tampered = WORKLOAD_WINS.replace('alpha [GT,#2]', 'alpha [GT,#1]').replace(
      'beta [#1]',
      'beta [#2]',
    );
    const report = fidelityOf(parseAblationDump(tampered));
    expect(report.cases).toBe(1);
    expect(report.agreed).toBe(0);
    expect(report.mismatches).toEqual(['d2']);
  });

  it('breaks a tie by name, which is the rule the engine’s own sort uses', () => {
    const tied = kase('d3', 'cpu', 'alpha', [
      service('alpha', 'GT,#1', '1.000', [['cpu', '1.000']]),
      service('aardvark', '#2', '1.000', [['cpu', '1.000']]),
    ]);
    expect(fidelityOf(parseAblationDump(tied)).agreed).toBe(0);
    const alphabetical = tied.replace('GT,#1', 'GT,#2').replace('aardvark [#2]', 'aardvark [#1]');
    expect(fidelityOf(parseAblationDump(alphabetical)).agreed).toBe(1);
  });
});

/** A dump where ONE case reproduces the engine and one does not: a PARTIAL fidelity, not zero. */
function partiallyFaithful(): string {
  const tampered = WORKLOAD_WINS.replace('alpha [GT,#2]', 'alpha [GT,#1]').replace(
    'beta [#1]',
    'beta [#2]',
  );
  return `${TRUTH_WINS}\n${tampered}`;
}

/** The mutation that must be caught: accepting a partial reproduction as if it were a total one. */
export const PARTIAL_CASES = partiallyFaithful();

describe('familyAblation — one row per excluded family, split by fault type', () => {
  it('reproduces the control accuracy and shows the exclusion that moves a case', () => {
    const report = familyAblation(parseAblationDump(`${TRUTH_WINS}\n${WORKLOAD_WINS}`));
    const control = report.rows[0]!;
    expect(control.label).toBe('all families (control)');
    expect([control.correct, control.cases]).toEqual([1, 2]);
    const without = report.rows.find((row) => row.label === 'without workload')!;
    // Dropping the family makes the second case correct and leaves the first alone: +1, and the per-type
    // cell is what says so — a net would hide a fault type moving the other way.
    expect(without.correct).toBe(2);
    expect(without.perFault['cpu']).toEqual({ hits: 2, cases: 2 });
  });

  it('keeps a service that has NOTHING left out of the ranking instead of scoring it as zero', () => {
    // A family exclusion can empty a service's evidence. Scoring it at 0 would leave it ranked — last, but
    // present — and a case whose truth is that service would count as a MISS for a reason the exclusion did
    // not cause. Excluding it is the honest reading: the dump has no evidence about it any more.
    const onlyWorkload = kase('d4', 'cpu', 'alpha', [
      service('alpha', 'GT,#2', '0.100', [['cpu', '0.100']]),
      service('beta', '#1', '1.400', [['workload', '1.400']]),
    ]);
    const report = familyAblation(parseAblationDump(onlyWorkload));
    expect(report.rows.find((row) => row.label === 'without workload')!.correct).toBe(1);
  });

  it('lists every family the dump carries, sorted, so the table has no hidden row', () => {
    const report = familyAblation(parseAblationDump(TRUTH_WINS));
    expect(report.families).toEqual(['latency', 'workload']);
    expect(report.rows.map((row) => row.label)).toEqual([
      'all families (control)',
      'without latency',
      'without workload',
    ]);
  });
});

describe('formatAblation — the refusal is the first thing printed', () => {
  it('prints the table when the reproduction is total, and says so', () => {
    const text = formatAblation(familyAblation(parseAblationDump(TRUTH_WINS)));
    expect(text).toContain('fidelity: 1/1 — the maxima ARE the ranking');
    expect(text).toContain('all families (control)');
    expect(text).toContain('regressed fault types: NONE');
  });

  it('REFUSES the table when the two readings differ, and explains what the difference means', () => {
    // The branch that matters. A partial reproduction means some other term decided the order, so every delta
    // would describe a ranking this dump does not contain — and a reader who met the table first would have
    // taken one. The assertion is that the table is ABSENT, not merely that a warning is present.
    const tampered = WORKLOAD_WINS.replace('alpha [GT,#2]', 'alpha [GT,#1]').replace(
      'beta [#1]',
      'beta [#2]',
    );
    const text = formatAblation(familyAblation(parseAblationDump(tampered)));
    expect(text).toContain('REFUSED');
    expect(text).toContain('0/1');
    expect(text).toContain('d2');
    expect(text).not.toContain('all families (control)');
    expect(text).not.toContain('regressed fault types');
  });

  it('REFUSES on a PARTIAL reproduction — the case a zero-or-total fence cannot see', () => {
    // The first draft of this file asserted the refusal on a 0/1 fidelity, which a rule of
    // "refuse only when NOTHING reproduces" also passes: the fence was satisfied by the wrong branch, and a
    // mutation that accepted every partial reproduction left it green. A partial reproduction is the state a
    // dump with ONE other active term produces, and it is the state that must refuse.
    const report = familyAblation(parseAblationDump(partiallyFaithful()));
    expect(report.fidelity.agreed).toBe(1);
    expect(report.fidelity.cases).toBe(2);
    const text = formatAblation(report);
    expect(text).toContain('REFUSED');
    expect(text).toContain('1/2');
    expect(text).not.toContain('all families (control)');
  });

  it('names a regressed fault type beside the net, so a gain cannot be read alone', () => {
    // A control of two cases where excluding `latency` breaks one: the net is negative AND the fault type is
    // named. A formatter that printed only `net:` would let a reader take the sum of two opposite movements.
    const breakable = kase('d5', 'disk', 'alpha', [
      service('alpha', 'GT,#1', '2.000', [['latency', '2.000']]),
      service('beta', '#2', '0.400', [['latency', '0.400']]),
    ]);
    const other = kase('d6', 'cpu', 'alpha', [
      service('alpha', 'GT,#2', '0.900', [['cpu', '0.900']]),
      service('beta', '#1', '1.100', [['cpu', '1.100']]),
    ]);
    const text = formatAblation(familyAblation(parseAblationDump(`${breakable}\n${other}`)));
    expect(text).toContain('net:');
    expect(text).not.toContain('regressed fault types: NONE');
    expect(text).toContain('without latency: disk');
  });
});

describe('parseAblationArgs — one flag, and it is required', () => {
  it('reads the dump path', () => {
    expect(parseAblationArgs(['--dump', 'a.txt'])).toEqual({ dump: 'a.txt' });
  });

  it('refuses an absent, empty or valueless flag rather than falling back to a default artifact', () => {
    // A default would make the tool analyse whichever dump sits in the working directory, which is how a
    // number acquires a population nobody chose. All three refusals are the same rule.
    expect(() => parseAblationArgs([])).toThrow(/--dump/);
    expect(() => parseAblationArgs(['--dump'])).toThrow(/--dump/);
    expect(() => parseAblationArgs(['--dump', '--other'])).toThrow(/--dump/);
    expect(() => parseAblationArgs(['--dump', ''])).toThrow(/--dump/);
  });
});

describe('runAblation — the whole tool, from text to block', () => {
  it('renders a total reproduction without refusing', () => {
    const text = runAblation(`${TRUTH_WINS}\n${WORKLOAD_WINS}`);
    expect(text.startsWith('metric-family ablation — 2 cases')).toBe(true);
    expect(text).toContain('fidelity: 2/2');
  });
});
