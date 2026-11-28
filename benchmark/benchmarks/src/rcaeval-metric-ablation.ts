/**
 * Metric-family ablation over a DIAG dump — the screen that asks "which evidence family is doing the
 * ranking?" without spending a benchmark run.
 *
 * ## Why this exists
 *
 * The anomaly a service is ranked by is the MAXIMUM over its surviving metrics, and that maximum is taken
 * across metric FAMILIES that are not comparable: one pod exposes `latency`, another `latency-50`/`latency-90`,
 * a third `workload`, and those are three different statistics with three different baselines. When a case
 * is decided by a fourth decimal digit inside a band of near-ties, "which family the winner happened to
 * carry" is part of the answer — and the published cell average cannot say so.
 *
 * The dump carries enough to ask the question directly: it prints, per service, every metric that survived
 * the guards with its score. Removing a family and re-taking the maximum models "what would this case have
 * ranked if that family carried no evidence", for every case, from one artifact.
 *
 * ## The fidelity control is not optional
 *
 * A re-ranking that cannot reproduce the engine cannot speak about it, and the two candidates differ by an
 * order of magnitude in faithfulness:
 *
 * | dump | the simulation reproduces the engine's rank-1 on |
 * | --- | --- |
 * | RCAEval RE1-OnlineBoutique (125 cases) | **125 / 125** — every other term is zero there, so the ranking IS the maximum |
 * | FSE'26 (1422 cases) | **317 / 1422** — trace, latency, log, failed-edge, pool and stability terms all contribute, so it is not |
 *
 * So this module REFUSES to print a delta table unless the reproduction is total, and prints what it found
 * instead. That refusal is the whole tool: an instrument that silently reports a wrong population's deltas
 * is worse than no instrument, because the number looks like a measurement.
 *
 * @module benchmarks/rcaeval-metric-ablation
 */

/** One service's scored metrics, as the dump prints them. */
export interface AblationService {
  /** Service id. */
  readonly name: string;
  /** The rank the engine gave it, or `undefined` when the dump's tag carried none. */
  readonly rank: number | undefined;
  /** The score the engine ranked on. */
  readonly anomaly: number;
  /** Surviving metric label → the score the engine gave it. */
  readonly metrics: ReadonlyMap<string, number>;
}

/** One case, reduced to what a family ablation needs. */
export interface AblationCase {
  /** Datapack id. */
  readonly datapack: string;
  /** The dump's fault-type token. */
  readonly faultType: string;
  /** Ground-truth services; the first is the one a top-1 score is about. */
  readonly truths: readonly string[];
  /** Services in the order the dump printed them, which is the engine's ranking order. */
  readonly services: readonly AblationService[];
}

const HEADER = /^DIAG datapack=(\S+) faultType=(\S+) GT=\[([^\]]*)\]/;
const SERVICE = /^ {2}(\S+) \[([^\]]+)\] selfAnomaly=(-?[\d.]+(?:e[+-]?\d+)?)/;
const TOP = /([A-Za-z][\w.-]*)=(-?[\d.]+(?:e[+-]?\d+)?)\{/g;
const RANK = /#(\d+)/;

/**
 * Parse a DIAG dump into the shape an ablation needs.
 *
 * Only three line kinds matter — the case header, the service line and `metricTop(...)` — and every other
 * line is skipped rather than validated: the dump is a report, and a parser that demanded its every field
 * would refuse a dump for carrying MORE than it needs.
 *
 * @param text - The dump's full text.
 * @returns One entry per case that names a ground truth and printed at least one service.
 */
export function parseAblationDump(text: string): AblationCase[] {
  const cases: AblationCase[] = [];
  let current:
    | { datapack: string; faultType: string; truths: string[]; services: AblationService[] }
    | undefined;
  let service:
    | { name: string; rank: number | undefined; anomaly: number; metrics: Map<string, number> }
    | undefined;

  for (const line of text.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      current = {
        datapack: header[1]!,
        faultType: header[2]!,
        truths: header[3]!
          .split(',')
          .map((one) => one.trim())
          .filter((one) => one !== ''),
        services: [],
      };
      cases.push(current as AblationCase as never);
      service = undefined;
      continue;
    }
    if (current === undefined) continue;
    const svc = SERVICE.exec(line);
    if (svc) {
      const rank = RANK.exec(svc[2]!);
      service = {
        name: svc[1]!,
        rank: rank === null ? undefined : Number(rank[1]),
        anomaly: Number(svc[3]),
        metrics: new Map(),
      };
      (current.services as AblationService[]).push(service as never);
      continue;
    }
    if (service === undefined || !line.startsWith('    metricTop')) continue;
    for (const match of line.matchAll(TOP)) service.metrics.set(match[1]!, Number(match[2]));
  }
  return cases.filter((one) => one.truths.length > 0 && one.services.length > 0);
}

/** The top-1 service a re-ranking produces, by score and then by name, as the engine breaks ties. */
function leaderOf(
  kase: AblationCase,
  score: (metric: string, value: number) => number | undefined,
): string | undefined {
  let best: { name: string; value: number } | undefined;
  for (const svc of kase.services) {
    let top = -Infinity;
    for (const [metric, value] of svc.metrics) {
      const scaled = score(metric, value);
      if (scaled !== undefined && scaled > top) top = scaled;
    }
    if (top === -Infinity) continue;
    if (best === undefined || top > best.value || (top === best.value && svc.name < best.name)) {
      best = { name: svc.name, value: top };
    }
  }
  return best?.name;
}

/** Whether the dump's maxima reproduce the engine's own rank-1, case by case. */
export interface Fidelity {
  /** Cases compared. */
  readonly cases: number;
  /** Cases where they agree. */
  readonly agreed: number;
  /** Datapacks they disagree on, named so a divergence is reproducible rather than counted. */
  readonly mismatches: readonly string[];
}

/**
 * Hold the simulation to the engine.
 *
 * The engine's rank-1 is the service its own ranking put first, which the dump states in the line's `[#1]`
 * tag. The simulation's rank-1 is the maximum of that service's printed metric scores. When those two
 * disagree, some OTHER term moved the order and every delta this module could print would be about a
 * ranking that does not exist.
 *
 * @param cases - Parsed cases.
 * @returns The agreement, and every datapack where it failed.
 */
export function fidelityOf(cases: readonly AblationCase[]): Fidelity {
  let agreed = 0;
  const mismatches: string[] = [];
  for (const kase of cases) {
    const engine = kase.services.find((svc) => svc.rank === 1)?.name;
    const simulated = leaderOf(kase, (_metric, value) => value);
    if (engine !== undefined && engine === simulated) agreed++;
    else mismatches.push(kase.datapack);
  }
  return { cases: cases.length, agreed, mismatches };
}

/** One fault type's cell: how many of its cases a candidate gets right. */
export interface FaultCell {
  readonly hits: number;
  readonly cases: number;
}

/** One candidate's score over the whole population, split the way the benchmark prints it. */
export interface AblationRow {
  /** What the row is. */
  readonly label: string;
  readonly correct: number;
  readonly cases: number;
  /**
   * Fault type → hits and cases, so a regression is visible per type rather than as a net.
   *
   * Keyed by the POPULATION's fault list rather than by whatever the row happened to see: every candidate
   * scores every case, so an absent key would be a defect in this module and not a fact about the corpus.
   * Declaring it total is what lets the formatter index it without a fallback, and a fallback here would be
   * a branch no input can reach — dead code the coverage gate pays for (law 6).
   */
  readonly perFault: Readonly<Record<string, FaultCell>>;
}

/** The ablation table, with the fidelity that licenses it. */
export interface AblationReport {
  readonly fidelity: Fidelity;
  /** Families the dump carries, in sorted order. */
  readonly families: readonly string[];
  /** The control row, then one row per excluded family. */
  readonly rows: readonly AblationRow[];
}

/**
 * Score one candidate over the population.
 *
 * @param cases - Parsed cases.
 * @param exclude - Families whose evidence is removed. Empty = the control.
 * @returns The row.
 */
function scoreCandidate(
  cases: readonly AblationCase[],
  exclude: ReadonlySet<string>,
  label: string,
  faults: readonly string[],
): AblationRow {
  let correct = 0;
  const perFault: Record<string, FaultCell> = {};
  for (const fault of faults) perFault[fault] = { hits: 0, cases: 0 };
  for (const kase of cases) {
    const leader = leaderOf(kase, (metric, value) => (exclude.has(metric) ? undefined : value));
    const hit = leader !== undefined && leader === kase.truths[0] ? 1 : 0;
    correct += hit;
    const cell = perFault[kase.faultType]!;
    perFault[kase.faultType] = { hits: cell.hits + hit, cases: cell.cases + 1 };
  }
  return { label, correct, cases: cases.length, perFault };
}

/**
 * Run the control and one exclusion per family.
 *
 * @param cases - Parsed cases.
 * @returns The report, whose fidelity the formatter refuses on.
 */
export function familyAblation(cases: readonly AblationCase[]): AblationReport {
  const families = [
    ...new Set(cases.flatMap((kase) => kase.services.flatMap((svc) => [...svc.metrics.keys()]))),
  ].sort();
  const faults = [...new Set(cases.map((kase) => kase.faultType))].sort();
  const rows: AblationRow[] = [scoreCandidate(cases, new Set(), 'all families (control)', faults)];
  for (const family of families) {
    rows.push(scoreCandidate(cases, new Set([family]), `without ${family}`, faults));
  }
  return { fidelity: fidelityOf(cases), families, rows };
}

/**
 * Render the ablation, or refuse.
 *
 * The refusal is the first thing printed and the table is not printed at all: a reader who met the table
 * first would have taken a delta about the wrong ranking. `reason` says why the two readings differ, which
 * for a dump carrying other terms is the honest explanation rather than a defect.
 *
 * @param report - The report.
 * @returns The block.
 */
export function formatAblation(report: AblationReport): string {
  const { fidelity } = report;
  const head = `metric-family ablation — ${fidelity.cases} cases from the dump's own service lines`;
  if (fidelity.agreed !== fidelity.cases) {
    return [
      head,
      `  REFUSED: the dump's maxima reproduce the engine's rank-1 on ${fidelity.agreed}/${fidelity.cases} cases`,
      '  A re-ranking that cannot reproduce the engine cannot speak about it: where the two disagree, a term',
      '  other than the metric maximum decided the order, so every delta below would describe a ranking this',
      '  dump does not contain. Screen on a dump whose ranking IS the maximum (RCAEval, where every other',
      '  term is zero), and measure the rest by dispatch.',
      `  first disagreements: ${fidelity.mismatches.slice(0, 5).join(', ')}`,
    ].join('\n');
  }
  const faults = Object.keys(report.rows[0]!.perFault).sort();
  const width = 30;
  const header =
    `  ${'candidate'.padEnd(width)} ${'correct'.padStart(9)}  ` +
    faults.map((fault) => fault.slice(0, 12).padStart(13)).join('');
  const lines = [
    head,
    `  fidelity: ${fidelity.agreed}/${fidelity.cases} — the maxima ARE the ranking`,
    '',
    header,
  ];
  for (const row of report.rows) {
    const cells = faults
      .map((fault) => {
        const cell = row.perFault[fault]!;
        return `${`${cell.hits}/${cell.cases}`.padStart(7)} ${`${((100 * cell.hits) / cell.cases).toFixed(1)}%`.padStart(5)}`;
      })
      .join('  ');
    lines.push(
      `  ${row.label.padEnd(width)} ${`${row.correct}/${row.cases}`.padStart(9)}  ${cells}`,
    );
  }
  const control = report.rows[0]!;
  const regressed = report.rows
    .slice(1)
    .flatMap((row) =>
      faults
        .filter((fault) => row.perFault[fault]!.hits < control.perFault[fault]!.hits)
        .map((fault) => `${row.label}: ${fault}`),
    );
  lines.push('');
  lines.push(
    `  net: ${report.rows
      .slice(1)
      .map(
        (row) =>
          `${row.label} ${row.correct - control.correct >= 0 ? '+' : ''}${row.correct - control.correct}`,
      )
      .join(', ')}`,
  );
  lines.push(`  regressed fault types: ${regressed.length === 0 ? 'NONE' : regressed.join(', ')}`);
  return lines.join('\n');
}

/**
 * Parse this tool's flag surface.
 *
 * One flag, and it is REQUIRED: the tool has no default artifact, because a default would make
 * `npx tsx …/ablate-rcaeval-dump.ts` print an analysis of whichever dump happened to sit in the working
 * directory. That is how a number acquires a population nobody chose.
 *
 * @param argv - Arguments after the script name.
 * @returns The dump path.
 * @throws When `--dump` is absent or carries no value.
 */
export function parseAblationArgs(argv: readonly string[]): { dump: string } {
  const at = argv.indexOf('--dump');
  const value = at === -1 ? undefined : argv[at + 1];
  if (value === undefined || value.startsWith('--') || value === '') {
    throw new Error('ablate-rcaeval-dump: --dump <path to a DIAG dump> is required');
  }
  return { dump: value };
}

/**
 * Parse a dump and render the ablation, which is the whole tool.
 *
 * Split from the CLI so a test can call it: the CLI calls `main` at import time and therefore cannot be
 * loaded by one.
 *
 * @param text - The dump's full text.
 * @returns The rendered block, refused or not.
 */
export function runAblation(text: string): string {
  return formatAblation(familyAblation(parseAblationDump(text)));
}
