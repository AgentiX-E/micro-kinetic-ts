/**
 * Read the `--diagnose` dumps back as data, and turn a pair of them into the
 * regression set and its mechanism.
 *
 * The benchmark runner prints a `DIAG` block per case (see
 * `packages/kinetic/../fse26-diagnose.ts`) when `--diagnose` names that case's
 * fault type. A fault-type-level gap cannot be diagnosed from the scalar Top@1,
 * and a pair of dumps — the same cases scored under two log-signal modes — can
 * be, provided the two are reduced to something comparable. That reduction is
 * this module.
 *
 * It exists as a module rather than a throwaway script because every candidate
 * ranking fix has to be re-measured against the same set: the question is never
 * only "does this recover the losses" but "does it keep the gains", and both
 * halves need the identical extraction. The parser is pure and takes the log
 * text, so it is testable against synthetic blocks and can also be pointed at a
 * downloaded CI artifact.
 *
 * @module benchmarks/fse26-diagnose-analyze
 */

/**
 * The score decomposition of one metric, as the `metricTop` line reports it.
 *
 * Needed because the score alone cannot say whether a metric won on a genuine
 * deviation or on a bonus, nor how large its rise was. The anomaly score is
 * unbounded in the RISE direction and hard-capped at `log10(2)` in the DROP
 * direction, so a high score IS a rise — the ratio says how extreme.
 */
export interface DiagnosedBreakdown {
  readonly deviation: number;
  readonly trend: number;
  readonly cv: number;
  readonly burst: number;
  /** `(max − baseline) / baseline` — unbounded. */
  readonly riseRatio: number;
  /** `(baseline − min) / baseline` — bounded at 1 by construction. */
  readonly dropRatio: number;
  /** The pre-anomaly baseline the two ratios were measured against. */
  readonly baselineMean: number;
}

/** One metric's fate, as the `DIAG` block reports it. */
export interface DiagnosedMetricOutcome {
  readonly label: string;
  /**
   * The engine's outcome word. Kept as a plain string rather than a closed
   * union: this reader must survive an engine that adds a guard, and a strict
   * union here would turn a new reason into a parse failure.
   */
  readonly outcome: string;
  /** The metric's score. Meaningful only when `outcome` is `kept`. */
  readonly score: number;
  /** The score decomposition, when the block reported one. */
  readonly breakdown?: DiagnosedBreakdown;
}

/** One service's signal inventory, as the `DIAG` block reports it. */
export interface DiagnosedService {
  readonly serviceId: string;
  /** Whether the case's ground truth includes this service. */
  readonly isGroundTruth: boolean;
  /** The engine's rank for this service, when it predicted it. */
  readonly predictedRank: number | undefined;
  readonly selfAnomaly: number;
  readonly logScore: number;
  /**
   * The metric that drove this service's anomaly score, or `''` when the engine
   * named none (the block prints `-` for that).
   */
  readonly dominantMetric: string;
  readonly errorCount: number;
  readonly fatalCount: number;
  readonly logicExceptionCount: number;
  readonly httpExceptionCount: number;
  /**
   * The service's metric competition, or `undefined` when the block did not
   * report it (an older dump, or a service the formatter chose not to render).
   *
   * A list whose declared size disagrees with the entries actually printed is
   * reported as `undefined`, never as a short list: a truncated inventory reads
   * exactly like a complete one, which is how a parser once fabricated
   * `gt_http = 0` for every replace-code case.
   */
  readonly metricOutcomes: readonly DiagnosedMetricOutcome[] | undefined;
}

/** One case's diagnostic block, as data. */
export interface DiagnosedCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly groundTruth: readonly string[];
  /** The log-signal mode the block was produced under. */
  readonly logSignalMode: string;
  readonly services: readonly DiagnosedService[];
  /** The engine's ranking for this case, best first. */
  readonly prediction: readonly string[];
}

const HEADER_RE =
  /^DIAG datapack=(\S+) faultType=(\S+) GT=\[([^\]]*)\] services=(\d+)(?: logMode=(\S+))?$/;
const SERVICE_RE =
  /^ {2}(\S+)(?: \[([^\]]*)\])? selfAnomaly=(\S+) logScore=(\S+) dominant=(\S*) err=(\d+) fatal=(\d+) logic=(\d+) http=(\d+)$/;
const PREDICTION_RE = /^ {2}prediction=\[([^\]]*)\]$/;
const METRIC_KEPT_RE = /^ {4}metricKept\((\d+)\):(?: (.*))?$/;
const METRIC_DROP_RE = /^ {4}metricDrop\((\d+)\):(?: (.*))?$/;
/**
 * The shape line always carries at least one entry: the producer omits the line
 * entirely when it has no decomposition to print. Requiring the body here rather
 * than defaulting an absent one keeps a `?? ''` fallback out of the reader — a
 * fallback that could only ever fire on a line the producer cannot write.
 */
const METRIC_TOP_RE = /^ {4}metricTop\((\d+)(?:\/(\d+))?\): (.+)$/;

/**
 * `label=score{dev=…,trend=…,cv=…,burst=…,rise=…,drop=…,base=…}`.
 *
 * The label is `.+?` and the score `[^{]+` because the score is immediately
 * followed by `{`, which a `\S+` would swallow.
 */
const TOP_ENTRY_RE =
  /^(.+?)=([^{]+)\{dev=(\S+),trend=(\S+),cv=(\S+),burst=(\S+),rise=(\S+),drop=(\S+),base=(\S+)\}$/;

/**
 * Split a space-separated `label=value` / `label:value` list.
 *
 * The separator is the LAST occurrence, not the first: metric labels are
 * dotted names that never contain `=` or `:`, but a label that did would then
 * corrupt one entry rather than the whole list, and the declared-count check
 * below would catch it either way.
 */
function parseEntries(body: string | undefined, separator: '=' | ':'): string[][] {
  if (body === undefined || body === '') return [];
  return body
    .split(' ')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const at = entry.lastIndexOf(separator);
      return at < 0 ? [entry, ''] : [entry.slice(0, at), entry.slice(at + 1)];
    });
}

/** Split a bracketed list into trimmed, non-empty entries. */
function parseList(body: string | undefined): string[] {
  if (body === undefined) return [];
  return body
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * A service under construction.
 *
 * The metric lines trail the service line they belong to, so the outcome list
 * has to be appended to after the service has been read. Kept private: the only
 * thing that needs the mutable shape is the parser, and exposing it would let a
 * consumer mutate a parsed dump.
 */
interface MutableService extends Omit<DiagnosedService, 'metricOutcomes'> {
  metricOutcomes: DiagnosedMetricOutcome[] | undefined;
}

/**
 * Parse every `DIAG` block in a dump, ignoring everything around them.
 *
 * The dumps are printed into the benchmark's stdout together with the run
 * header and the summary tables, so the parser scans for block starts rather
 * than expecting the text to be blocks only. A block that starts but never
 * reaches its `prediction=` line is dropped: a truncated block is worse than an
 * absent one, because its `services` list would read as complete.
 *
 * @param text - The log text (or any text containing `DIAG` blocks).
 * @returns One entry per complete block, in file order.
 */
export function parseDiagnosticDump(text: string): DiagnosedCase[] {
  const cases: DiagnosedCase[] = [];
  let current:
    | {
        datapack: string;
        faultType: string;
        groundTruth: string[];
        logSignalMode: string;
        services: MutableService[];
      }
    | undefined;
  // The metric lines follow the service they belong to, so the parser has to
  // remember which service it last emitted rather than which case it is in.
  let lastService: MutableService | undefined;
  // The inventory currently being read. It is opened by a `metricKept` line and
  // extended by the `metricDrop` line that follows. `undefined` therefore means
  // "this block never opened an inventory", which is what makes a lost
  // `metricKept` line detectably different from an empty one: a dropped-only
  // list would otherwise match its own declared count and read as complete.
  let openOutcomes: DiagnosedMetricOutcome[] | undefined;
  // The count the block DECLARED, accumulated across both lines. An inventory
  // that disagrees with it is discarded rather than shortened — a short
  // inventory reads exactly like a complete one.
  let declaredOutcomeCount = 0;

  const finalizeOutcomes = (): void => {
    if (lastService === undefined) return;
    const outcomes = openOutcomes;
    if (outcomes === undefined) return;
    const faithful =
      outcomes.length === declaredOutcomeCount &&
      outcomes.every((outcome) => Number.isFinite(outcome.score));
    lastService.metricOutcomes = faithful ? outcomes : undefined;
  };

  for (const line of text.split('\n')) {
    const header = HEADER_RE.exec(line);
    if (header) {
      // A new header without a footer means the previous block was truncated.
      finalizeOutcomes();
      current = {
        datapack: header[1]!,
        faultType: header[2]!,
        groundTruth: parseList(header[3]),
        logSignalMode: header[5] ?? '',
        services: [],
      };
      lastService = undefined;
      declaredOutcomeCount = 0;
      openOutcomes = undefined;
      continue;
    }
    if (current === undefined) continue;

    const service = SERVICE_RE.exec(line);
    if (service) {
      finalizeOutcomes();
      const markers = parseList(service[2]);
      const rankMarker = markers.find((m) => m.startsWith('#'));
      const entries: MutableService = {
        serviceId: service[1]!,
        isGroundTruth: markers.includes('GT'),
        predictedRank: rankMarker === undefined ? undefined : Number(rankMarker.slice(1)),
        selfAnomaly: Number(service[3]),
        logScore: Number(service[4]),
        dominantMetric: service[5] === '-' ? '' : service[5]!,
        errorCount: Number(service[6]),
        fatalCount: Number(service[7]),
        logicExceptionCount: Number(service[8]),
        httpExceptionCount: Number(service[9]),
        metricOutcomes: undefined,
      };
      current.services.push(entries);
      lastService = entries;
      declaredOutcomeCount = 0;
      openOutcomes = undefined;
      continue;
    }

    const kept = METRIC_KEPT_RE.exec(line);
    if (kept && lastService !== undefined) {
      finalizeOutcomes();
      openOutcomes = parseEntries(kept[2], '=').map(([label, score]) => ({
        label: label!,
        outcome: 'kept',
        score: Number(score),
      }));
      declaredOutcomeCount = Number(kept[1]);
      continue;
    }

    const dropped = METRIC_DROP_RE.exec(line);
    if (dropped && lastService !== undefined) {
      // A dropped line with no open inventory is a malformed block: it is
      // ignored outright, so the service reads as "unreported" rather than
      // acquiring a fabricated kept-less list.
      if (openOutcomes !== undefined) {
        openOutcomes.push(
          ...parseEntries(dropped[2], ':').map(([label, outcome]) => ({
            label: label!,
            outcome: outcome!,
            score: 0,
          })),
        );
        declaredOutcomeCount += Number(dropped[1]);
      }
      continue;
    }

    const top = METRIC_TOP_RE.exec(line);
    if (top && openOutcomes !== undefined) {
      // The shape line is space-separated like the other two, but each entry is
      // `label=score{…}` rather than a single `key=value` pair, so it is split
      // here rather than through the shared one-separator helper.
      const raw = top[3]!.split(' ').filter((entry) => entry.length > 0);
      const byLabel = new Map<string, DiagnosedBreakdown>();
      let parsed = 0;
      for (const entry of raw) {
        const m = TOP_ENTRY_RE.exec(entry);
        if (m === null) continue;
        const nums = [m[3], m[4], m[5], m[6], m[7], m[8], m[9]].map(Number);
        if (!nums.every((n) => Number.isFinite(n))) continue;
        byLabel.set(m[1]!, {
          deviation: nums[0]!,
          trend: nums[1]!,
          cv: nums[2]!,
          burst: nums[3]!,
          riseRatio: nums[4]!,
          dropRatio: nums[5]!,
          baselineMean: nums[6]!,
        });
        parsed++;
      }
      // A render whose entries did not all parse, or that claims a different
      // number of decompositions than it printed, is a truncation — and a
      // truncation reads as complete. The whole line is ignored, not partially
      // consumed: a partially attached decomposition is worse than none,
      // because it looks like a metric that genuinely carried no decomposition.
      const keptCount = openOutcomes.filter((outcome) => outcome.outcome === 'kept').length;
      const declaredKept = top[2] === undefined ? keptCount : Number(top[2]);
      if (parsed === raw.length && parsed === Number(top[1]) && declaredKept === keptCount) {
        openOutcomes = openOutcomes.map((outcome) => {
          const breakdown = byLabel.get(outcome.label);
          return breakdown === undefined ? outcome : { ...outcome, breakdown };
        });
      }
      continue;
    }

    const prediction = PREDICTION_RE.exec(line);
    if (prediction) {
      finalizeOutcomes();
      cases.push({
        datapack: current.datapack,
        faultType: current.faultType,
        groundTruth: current.groundTruth,
        logSignalMode: current.logSignalMode,
        services: current.services,
        prediction: parseList(prediction[1]),
      });
      current = undefined;
      lastService = undefined;
      declaredOutcomeCount = 0;
      openOutcomes = undefined;
    }
  }

  return cases;
}

/** Whether the engine's top-1 prediction is an accepted ground-truth service. */
export function isTop1Correct(kase: DiagnosedCase): boolean {
  const top = kase.prediction[0];
  return top !== undefined && kase.groundTruth.includes(top);
}

/** How a case's top-1 outcome changed between two modes. */
export type DiagnosticDeltaKind = 'regressed' | 'gained' | 'both-correct' | 'both-wrong';

/** One case's outcome under both modes. */
export interface DiagnosticDelta {
  readonly datapack: string;
  readonly faultType: string;
  readonly kind: DiagnosticDeltaKind;
  readonly groundTruth: readonly string[];
  readonly top1Before: string | undefined;
  readonly top1After: string | undefined;
}

/**
 * Pair two dumps by datapack and classify each case's top-1 outcome.
 *
 * Only cases present in BOTH dumps are compared. A case missing from one side
 * is skipped rather than counted as a change: the two runs are normally the same
 * case set, and if they are not, the difference is a property of the runs, not
 * of the mode. `kind` is stated from the perspective of the SECOND dump, so
 * `regressed` means "correct before, wrong after".
 *
 * @param before - Dump scored under the baseline configuration.
 * @param after - Dump scored under the candidate configuration.
 * @returns One entry per case present in both, in `before` order.
 */
export function diffDiagnostics(
  before: readonly DiagnosedCase[],
  after: readonly DiagnosedCase[],
): DiagnosticDelta[] {
  const afterByDatapack = new Map(after.map((kase) => [kase.datapack, kase]));
  const deltas: DiagnosticDelta[] = [];

  for (const caseBefore of before) {
    const caseAfter = afterByDatapack.get(caseBefore.datapack);
    if (caseAfter === undefined) continue;
    const correctBefore = isTop1Correct(caseBefore);
    const correctAfter = isTop1Correct(caseAfter);
    const kind: DiagnosticDeltaKind =
      correctBefore && !correctAfter
        ? 'regressed'
        : !correctBefore && correctAfter
          ? 'gained'
          : correctBefore
            ? 'both-correct'
            : 'both-wrong';
    deltas.push({
      datapack: caseBefore.datapack,
      faultType: caseBefore.faultType,
      kind,
      groundTruth: caseBefore.groundTruth,
      top1Before: caseBefore.prediction[0],
      top1After: caseAfter.prediction[0],
    });
  }

  return deltas;
}

/**
 * The signal inventory behind one regression.
 *
 * The hypothesis under test is that the framework-HTTP half of the `logicHttp`
 * mode rewards a VICTIM: the faulting service emits no exception of its own, its
 * callers see the broken calls and flood `HttpServerErrorException`, and the
 * caller's count then exceeds the source's and takes the top rank. Two booleans
 * state the two halves of that claim per case, so the summary can be counted
 * rather than argued.
 */
export interface RegressionMechanism {
  readonly datapack: string;
  readonly faultType: string;
  /**
   * The ground-truth service the case should rank first.
   *
   * Non-optional because `regressionMechanism` is called on cases that were
   * CORRECT before, and a case is only correct when it named a ground truth.
   * A caller that passes a delta of another kind still gets a value: the
   * contract is stated at {@link regressionMechanism} instead, which defaults
   * the field and is tested for the absent case.
   */
  readonly groundTruth: string;
  readonly top1Before: string | undefined;
  readonly top1After: string | undefined;
  /** The source's framework-HTTP line count under the `after` mode. */
  readonly sourceHttpCount: number | undefined;
  /** The winning (wrong) service's framework-HTTP line count. */
  readonly winnerHttpCount: number | undefined;
  /** The source's self-caused logic-exception count under the `after` mode. */
  readonly sourceLogicCount: number | undefined;
  readonly winnerLogicCount: number | undefined;
  readonly sourceSelfAnomaly: number | undefined;
  readonly winnerSelfAnomaly: number | undefined;
  /** The framework-HTTP half alone explains the swap: winner floods, source does not. */
  readonly winnerOutfloodsSource: boolean;
}

/**
 * Summarise the signal inventory of one regression, read from the `after` dump.
 *
 * Ground truth is single-service on this benchmark (the loader accepts a list,
 * but every FSE'26 case names one service), so the comparison is between that
 * service and whatever the engine ranked first instead.
 *
 * @param delta - A delta classified as `regressed`.
 * @param after - The dump the regression was measured on.
 * @returns The inventory, with `undefined` fields where a service is absent.
 */
export function regressionMechanism(
  delta: DiagnosticDelta,
  after: readonly DiagnosedCase[],
): RegressionMechanism {
  const kase = after.find((candidate) => candidate.datapack === delta.datapack);
  const groundTruth = delta.groundTruth[0];
  const find = (serviceId: string | undefined) =>
    serviceId === undefined
      ? undefined
      : kase?.services.find((service) => service.serviceId === serviceId);

  const source = find(groundTruth);
  const winner = find(delta.top1After);

  return {
    datapack: delta.datapack,
    faultType: delta.faultType,
    groundTruth: groundTruth ?? '-',
    top1Before: delta.top1Before,
    top1After: delta.top1After,
    sourceHttpCount: source?.httpExceptionCount,
    winnerHttpCount: winner?.httpExceptionCount,
    sourceLogicCount: source?.logicExceptionCount,
    winnerLogicCount: winner?.logicExceptionCount,
    sourceSelfAnomaly: source?.selfAnomaly,
    winnerSelfAnomaly: winner?.selfAnomaly,
    winnerOutfloodsSource:
      source !== undefined &&
      winner !== undefined &&
      winner.httpExceptionCount > source.httpExceptionCount &&
      source.httpExceptionCount === 0,
  };
}

/**
 * The metric family a fault's signature is expected to live in.
 *
 * Stated by the caller rather than baked in: this module reduces a dump, and
 * which labels constitute a fault signature is a property of the fault under
 * investigation, not of the dump format.
 */
export interface MetricFamily {
  /** How the report names the family. */
  readonly label: string;
  /** Matches the labels that belong to the family. */
  readonly pattern: RegExp;
}

/**
 * One fault type's answer to the only question a metric diagnostic can settle:
 * was the fault signature DISCARDED BY A GUARD, or SCORED AND OUT-COMPETED?
 *
 * Those two readings call for completely different work — a guard fix against a
 * scoring change — and the scalar anomaly score cannot tell them apart, because
 * both leave the service with a score that some other metric produced.
 */
export interface FamilyCompetitionCell {
  readonly faultType: string;
  readonly cases: number;
  /** Cases whose source carries at least one metric of the family. */
  readonly sourcesWithFamily: number;
  /** Cases where at least one family metric survived the guards. */
  readonly sourcesKeepingFamily: number;
  /** Cases where every family metric the source carries was discarded. */
  readonly sourcesDroppingFamily: number;
  /** Cases where the source carries no family metric at all (a data gap). */
  readonly sourcesWithoutFamily: number;
  /** Cases whose source's DOMINANT metric is in the family. */
  readonly sourcesDominantInFamily: number;
  /** Cases where a family metric survived AND still lost the service competition. */
  readonly sourcesKeepingButLosingFamily: number;
}

/** Count deltas by kind, for a one-line summary of a comparison. */
export function tallyDeltas(
  deltas: readonly DiagnosticDelta[],
): Readonly<Record<DiagnosticDeltaKind, number>> {
  const tally: Record<DiagnosticDeltaKind, number> = {
    regressed: 0,
    gained: 0,
    'both-correct': 0,
    'both-wrong': 0,
  };
  for (const delta of deltas) tally[delta.kind] += 1;
  return tally;
}

/**
 * A non-stateful matcher for a metric family.
 *
 * A global or sticky pattern carries `lastIndex` between calls, so `test` would
 * answer differently on alternate invocations and silently halve every count.
 * Rebuilt without those flags, so the reducer stays a pure function of its
 * inputs regardless of how the caller wrote the pattern.
 */
function familyMatcher(family: MetricFamily): (label: string) => boolean {
  const pattern = new RegExp(family.pattern.source, family.pattern.flags.replace(/[gy]/g, ''));
  return (label) => pattern.test(label);
}

/**
 * Reduce one dump to the per-fault-type fate of a metric family.
 *
 * Only ground-truth services are examined: the question is what happened to the
 * fault source's signature, and a service that is neither the source nor a
 * prediction carries no answer. A case whose ground-truth service was not
 * rendered at all (no metric outcomes reported) is counted in `cases` but in
 * none of the family columns, which is how a dump produced by an older engine
 * reads as "unreported" rather than as "absent".
 *
 * @param cases - A parsed dump.
 * @param family - The labels that constitute the fault signature.
 * @returns One cell per fault type, in descending case count.
 */
export function familyCompetition(
  cases: readonly DiagnosedCase[],
  family: MetricFamily,
): FamilyCompetitionCell[] {
  interface Mutable {
    faultType: string;
    cases: number;
    sourcesWithFamily: number;
    sourcesKeepingFamily: number;
    sourcesDroppingFamily: number;
    sourcesWithoutFamily: number;
    sourcesDominantInFamily: number;
    sourcesKeepingButLosingFamily: number;
  }
  const byType = new Map<string, Mutable>();
  const isFamily = familyMatcher(family);

  for (const kase of cases) {
    const cell = byType.get(kase.faultType) ?? {
      faultType: kase.faultType,
      cases: 0,
      sourcesWithFamily: 0,
      sourcesKeepingFamily: 0,
      sourcesDroppingFamily: 0,
      sourcesWithoutFamily: 0,
      sourcesDominantInFamily: 0,
      sourcesKeepingButLosingFamily: 0,
    };
    cell.cases++;
    for (const source of kase.services) {
      if (!source.isGroundTruth || source.metricOutcomes === undefined) continue;
      const ofFamily = source.metricOutcomes.filter((outcome) => isFamily(outcome.label));
      const kept = ofFamily.filter((outcome) => outcome.outcome === 'kept');
      if (ofFamily.length === 0) cell.sourcesWithoutFamily++;
      else cell.sourcesWithFamily++;
      if (kept.length > 0) cell.sourcesKeepingFamily++;
      if (ofFamily.length > 0 && kept.length === 0) cell.sourcesDroppingFamily++;
      const dominantIsFamily = isFamily(source.dominantMetric);
      if (dominantIsFamily) cell.sourcesDominantInFamily++;
      if (kept.length > 0 && !dominantIsFamily) cell.sourcesKeepingButLosingFamily++;
    }
    byType.set(kase.faultType, cell);
  }

  return [...byType.values()].sort(
    (a, b) => b.cases - a.cases || (a.faultType < b.faultType ? -1 : 1),
  );
}

/**
 * Render the metric-competition report for a dump.
 *
 * @param cases - A parsed dump.
 * @param family - The metric family under investigation.
 * @param modeLabel - How to describe the configuration in the header.
 * @returns The report text, ending with a newline.
 */
export function formatMetricCompetitionReport(
  cases: readonly DiagnosedCase[],
  family: MetricFamily,
  modeLabel: string,
): string {
  const cells = familyCompetition(cases, family);
  const modes = [...new Set(cases.map((kase) => kase.logSignalMode))].filter((m) => m !== '');
  const lines: string[] = [];
  lines.push(`FSE'26 metric competition — ${modeLabel}`);
  lines.push(`  after-mode: ${modes.length > 0 ? modes.join(', ') : '(unrecorded)'}`);
  lines.push(`  cases: ${cases.length}`);
  lines.push(`  tracked family: ${family.label}`);
  lines.push('');
  if (cells.length === 0) {
    lines.push('No DIAG blocks were parsed.');
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    `  ${'fault type'.padEnd(30)} ${'cases'.padStart(6)} ${'has-fam'.padStart(8)} ` +
      `${'kept'.padStart(6)} ${'dropped'.padStart(8)} ${'absent'.padStart(7)} ` +
      `${'dominant'.padStart(9)} ${'kept-lost'.padStart(10)}`,
  );
  for (const cell of cells) {
    lines.push(
      `  ${cell.faultType.padEnd(30)} ${String(cell.cases).padStart(6)} ` +
        `${String(cell.sourcesWithFamily).padStart(8)} ${String(cell.sourcesKeepingFamily).padStart(6)} ` +
        `${String(cell.sourcesDroppingFamily).padStart(8)} ` +
        `${String(cell.sourcesWithoutFamily).padStart(7)} ` +
        `${String(cell.sourcesDominantInFamily).padStart(9)} ` +
        `${String(cell.sourcesKeepingButLosingFamily).padStart(10)}`,
    );
  }
  lines.push('');
  lines.push('  A source counts in "dropped" when every family metric it carries was discarded');
  lines.push('  by a guard, and in "kept-lost" when a family metric survived but lost');
  lines.push("  the competition for the source's own anomaly score.");
  return `${lines.join('\n')}\n`;
}

/**
 * `value` with fixed decimals, or `-` when the datum is absent.
 *
 * No non-finite guard: every caller passes a count the parser read with
 * `/\d+/`, so the value is `undefined` or a finite integer by construction.
 */
function num(value: number | undefined, digits = 3): string {
  return value === undefined ? '-' : value.toFixed(digits);
}

/** Render the per-fault-type breakdown of the deltas. */
function faultTypeTable(deltas: readonly DiagnosticDelta[]): string[] {
  const byType = new Map<string, { regressed: number; gained: number; total: number }>();
  for (const delta of deltas) {
    const cell = byType.get(delta.faultType) ?? { regressed: 0, gained: 0, total: 0 };
    cell.total++;
    if (delta.kind === 'regressed') cell.regressed++;
    if (delta.kind === 'gained') cell.gained++;
    byType.set(delta.faultType, cell);
  }
  const lines = ['  fault type                          cases  regressed  gained'];
  for (const [faultType, cell] of [...byType.entries()].sort((a, b) => b[1].total - a[1].total)) {
    lines.push(
      `  ${faultType.padEnd(34)} ${String(cell.total).padStart(5)} ` +
        `${String(cell.regressed).padStart(10)} ${String(cell.gained).padStart(7)}`,
    );
  }
  return lines;
}

/**
 * The one metric that decided a service's anomaly score: the highest-scoring
 * kept metric that carries a decomposition.
 *
 * A service with no such metric contributes nothing — its score cannot be
 * attributed, and inventing an attribution would be worse than reporting one.
 */
function decisiveMetric(
  service: DiagnosedService,
): (DiagnosedMetricOutcome & { breakdown: DiagnosedBreakdown }) | undefined {
  const candidates = (service.metricOutcomes ?? []).filter(
    (outcome): outcome is DiagnosedMetricOutcome & { breakdown: DiagnosedBreakdown } =>
      outcome.outcome === 'kept' && outcome.breakdown !== undefined,
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, current) => (current.score > best.score ? current : best));
}

/** How one population's decisive metrics were won. */
export interface AnomalyShapeCell {
  readonly population: string;
  /** Services in this population that carried an attributable metric. */
  readonly services: number;
  /** Decisive on the deviation term: `deviation ≥ 0.5 × score`. */
  readonly deviationLed: number;
  /** Decisive on a bonus: the three bonuses together exceed the deviation. */
  readonly bonusLed: number;
  /** A rise, not a drop: `riseRatio > dropRatio`. */
  readonly rise: number;
  readonly drop: number;
  /** Median `riseRatio` over the population, or `undefined` when empty. */
  readonly medianRiseRatio: number | undefined;
  readonly medianBaselineMean: number | undefined;
  /**
   * Decisive metrics whose baseline is at or below the `0.001` floor the
   * near-zero-baseline guard tests. A large surge here means the ABSOLUTE floor
   * is miscalibrated for the source's units, not that the guard is wrong.
   */
  readonly baselineAtFloor: number;
  /**
   * Median share of the decisive score contributed by each term. Read together
   * with the source population, this separates "the winner is carried by a
   * term the source is not" from "both are carried by the same term and the
   * winner simply has more of it" — only the first is a reweighting defect.
   */
  readonly medianDeviationShare: number | undefined;
  readonly medianTrendShare: number | undefined;
  readonly medianCvShare: number | undefined;
  readonly medianBurstShare: number | undefined;
  /**
   * Decisive metrics whose trend bonus is at least a quarter of the score.
   * `trendBonus = trendStrength × 0.15` and `trendStrength` is unbounded, so a
   * metric that drifts monotonically without a fault earns an open-ended bonus.
   */
  readonly trendHeavy: number;
}

/**
 * Profile how the decisive metrics of each service population were won.
 *
 * The question this answers: is a rank decided by a genuine deviation, or by a
 * bonus computed on a ratio whose baseline was tiny? The three bonuses are
 * bounded (`trend` by construction, `cv ≤ 0.075`, `burst = 0.1 × deviation`),
 * while `riseRatio` is unbounded — so a high score with a bonus-led
 * decomposition would be a different defect from a high score with a
 * deviation-led one.
 *
 * Populations are separated because a verdict needs a control: the ground-truth
 * source's decisive metric is what a *correct* attribution looks like on the
 * same cases as the wrong winner's.
 *
 * @param cases - A parsed dump.
 * @returns One cell per population, in a fixed order.
 */
export function anomalyShape(cases: readonly DiagnosedCase[]): AnomalyShapeCell[] {
  interface Mutable {
    population: string;
    services: number;
    deviationLed: number;
    bonusLed: number;
    rise: number;
    drop: number;
    rises: number[];
    baselines: number[];
    baselineAtFloor: number;
    deviationShares: number[];
    trendShares: number[];
    cvShares: number[];
    burstShares: number[];
    trendHeavy: number;
  }
  const populations: Mutable[] = [
    'ground-truth source',
    'wrong top-1 winner',
    'other predicted / bystander',
  ].map((population) => ({
    population,
    services: 0,
    deviationLed: 0,
    bonusLed: 0,
    rise: 0,
    drop: 0,
    rises: [],
    baselines: [],
    baselineAtFloor: 0,
    deviationShares: [],
    trendShares: [],
    cvShares: [],
    burstShares: [],
    trendHeavy: 0,
  }));

  for (const kase of cases) {
    for (const service of kase.services) {
      const decisive = decisiveMetric(service);
      if (decisive === undefined) continue;
      const { deviation, trend, cv, burst, riseRatio, dropRatio, baselineMean } =
        decisive.breakdown;
      const bonus = trend + cv + burst;
      const cell = service.isGroundTruth
        ? populations[0]!
        : service.serviceId === kase.prediction[0]
          ? populations[1]!
          : populations[2]!;
      cell.services++;
      if (deviation >= 0.5 * decisive.score) cell.deviationLed++;
      if (bonus > deviation) cell.bonusLed++;
      if (riseRatio > dropRatio) cell.rise++;
      else cell.drop++;
      cell.rises.push(riseRatio);
      cell.baselines.push(baselineMean);
      if (baselineMean <= 0.001) cell.baselineAtFloor++;
      // Shares are undefined for a non-positive score, which no kept metric can
      // have; guarded so the ratio never divides by zero if that changes.
      if (decisive.score > 0) {
        cell.deviationShares.push(deviation / decisive.score);
        cell.trendShares.push(trend / decisive.score);
        cell.cvShares.push(cv / decisive.score);
        cell.burstShares.push(burst / decisive.score);
      }
      if (trend >= 0.25 * decisive.score) cell.trendHeavy++;
    }
  }

  const median = (values: readonly number[]): number | undefined => {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  return populations.map((cell) => ({
    population: cell.population,
    services: cell.services,
    deviationLed: cell.deviationLed,
    bonusLed: cell.bonusLed,
    rise: cell.rise,
    drop: cell.drop,
    medianRiseRatio: median(cell.rises),
    medianBaselineMean: median(cell.baselines),
    baselineAtFloor: cell.baselineAtFloor,
    medianDeviationShare: median(cell.deviationShares),
    medianTrendShare: median(cell.trendShares),
    medianCvShare: median(cell.cvShares),
    medianBurstShare: median(cell.burstShares),
    trendHeavy: cell.trendHeavy,
  }));
}

/** `value` as a compact magnitude, or `-` when absent. */
function magnitude(value: number | undefined): string {
  if (value === undefined) return '-';
  if (value === 0) return '0';
  return Math.abs(value) >= 1000 || Math.abs(value) < 0.01
    ? value.toExponential(2)
    : value.toFixed(2);
}

/** A score share in [0, 1] at three decimals, or `-` when absent. */
function share(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(3);
}

/**
 * Render the anomaly-shape profile for a dump.
 *
 * @param cases - A parsed dump.
 * @param label - How to describe the source in the header.
 * @returns The report text, ending with a newline.
 */
export function formatAnomalyShapeReport(cases: readonly DiagnosedCase[], label: string): string {
  const cells = anomalyShape(cases);
  const attributable = cells.reduce((sum, cell) => sum + cell.services, 0);
  const lines: string[] = [];
  lines.push(`FSE'26 anomaly shape — ${label}`);
  lines.push(`  cases: ${cases.length}   services with an attributable metric: ${attributable}`);
  lines.push('');
  lines.push(
    `  ${'population'.padEnd(28)} ${'n'.padStart(5)} ${'dev-led'.padStart(8)} ` +
      `${'bonus-led'.padStart(10)} ${'rise'.padStart(6)} ${'drop'.padStart(6)} ` +
      `${'med-rise'.padStart(9)} ${'med-base'.padStart(9)} ${'base<=1e-3'.padStart(11)}`,
  );
  for (const cell of cells) {
    lines.push(
      `  ${cell.population.padEnd(28)} ${String(cell.services).padStart(5)} ` +
        `${String(cell.deviationLed).padStart(8)} ${String(cell.bonusLed).padStart(10)} ` +
        `${String(cell.rise).padStart(6)} ${String(cell.drop).padStart(6)} ` +
        `${magnitude(cell.medianRiseRatio).padStart(9)} ` +
        `${magnitude(cell.medianBaselineMean).padStart(9)} ` +
        `${String(cell.baselineAtFloor).padStart(11)}`,
    );
  }
  lines.push('');
  lines.push('  How those scores were composed (median share of the score):');
  lines.push(
    `  ${'population'.padEnd(28)} ${'n'.padStart(5)} ${'dev'.padStart(7)} ${'trend'.padStart(7)} ` +
      `${'cv'.padStart(7)} ${'burst'.padStart(7)} ${'trend>=25%'.padStart(11)}`,
  );
  for (const cell of cells) {
    lines.push(
      `  ${cell.population.padEnd(28)} ${String(cell.services).padStart(5)} ` +
        `${share(cell.medianDeviationShare).padStart(7)} ` +
        `${share(cell.medianTrendShare).padStart(7)} ` +
        `${share(cell.medianCvShare).padStart(7)} ` +
        `${share(cell.medianBurstShare).padStart(7)} ` +
        `${String(cell.trendHeavy).padStart(11)}`,
    );
  }
  lines.push('');
  lines.push('  "dev-led" means deviation ≥ half the score. A relative DROP is capped');
  lines.push('  at log10(2) ≈ 0.301, so a high score with rise > drop is an unbounded');
  lines.push('  rise; "base<=1e-3" counts decisive metrics the near-zero-baseline guard');
  lines.push('  would test, which is how a miscalibrated ABSOLUTE floor shows up. Compare');
  lines.push('  the composition columns across populations: the same term in both means the');
  lines.push('  winner has MORE of it, not a different one, and no reweighting separates them.');
  return `${lines.join('\n')}\n`;
}

/**
 * Render the full report for one comparison.
 *
 * Exported so the formatting is covered by a test rather than only by running
 * the CLI, which would leave the arithmetic in the header lines unverified.
 *
 * @param before - Parsed baseline dump.
 * @param after - Parsed candidate dump.
 * @param modeLabel - How to describe the two configurations in the header.
 * @returns The report text, ending with a newline.
 */
export function formatDiagnoseComparison(
  before: readonly DiagnosedCase[],
  after: readonly DiagnosedCase[],
  modeLabel: string,
): string {
  const deltas = diffDiagnostics(before, after);
  const tally = tallyDeltas(deltas);
  const regressions = deltas.filter((delta) => delta.kind === 'regressed');
  const mechanisms = regressions.map((delta) => regressionMechanism(delta, after));
  const explained = mechanisms.filter((mechanism) => mechanism.winnerOutfloodsSource).length;

  const lines: string[] = [];
  const modes = [...new Set(after.map((kase) => kase.logSignalMode))].filter((m) => m !== '');
  lines.push(`FSE'26 diagnostic comparison — ${modeLabel}`);
  lines.push(`  after-mode: ${modes.length > 0 ? modes.join(', ') : '(unrecorded)'}`);
  lines.push(
    `  cases compared: ${deltas.length}   regressed: ${tally.regressed}   ` +
      `gained: ${tally.gained}   unchanged-correct: ${tally['both-correct']}   ` +
      `unchanged-wrong: ${tally['both-wrong']}`,
  );
  lines.push('');
  lines.push('Per-fault-type:');
  lines.push(...faultTypeTable(deltas));
  lines.push('');

  if (regressions.length === 0) {
    lines.push('No regressions: the candidate is never worse than the baseline on these cases.');
    return `${lines.join('\n')}\n`;
  }

  lines.push(`Regressions (${regressions.length}) — source vs the service that took rank 1:`);
  // Built with the same widths as the rows below, so the columns cannot drift
  // apart when a label is reworded.
  lines.push(
    `  ${'datapack'.padEnd(36)} ${'faultType'.padEnd(20)} ${'GT'.padEnd(15)} ` +
      `${'top1(before→after)'.padEnd(30)} ${'src http/logic'.padEnd(15)} ` +
      `${'win http/logic'.padEnd(15)} out-flooded`,
  );
  for (const mechanism of mechanisms) {
    // Only `top1After` can be absent here, and only because "wrong" includes
    // "predicted nothing". The other three cannot be: `faultType` is a required
    // string, and a regression is defined as CORRECT before, which requires the
    // case to have named a ground truth and the engine to have ranked it first.
    // Defaulting those would be dead code that hides a widened type.
    lines.push(
      `  ${mechanism.datapack.padEnd(36)} ${mechanism.faultType.padEnd(20)} ` +
        `${mechanism.groundTruth.padEnd(15)} ` +
        `${`${mechanism.top1Before}→${mechanism.top1After ?? '-'}`.padEnd(30)} ` +
        `${`${num(mechanism.sourceHttpCount, 0)}/${num(mechanism.sourceLogicCount, 0)}`.padEnd(15)} ` +
        `${`${num(mechanism.winnerHttpCount, 0)}/${num(mechanism.winnerLogicCount, 0)}`.padEnd(15)} ` +
        `${mechanism.winnerOutfloodsSource ? 'YES' : 'no'}`,
    );
  }
  lines.push('');
  lines.push(
    `Mechanism 'the winner is a victim flooding framework HTTP while the source emits none': ` +
      `${explained}/${regressions.length} regressions.`,
  );
  if (explained < regressions.length) {
    lines.push(
      `  ${regressions.length - explained} regression(s) need a different explanation — ` +
        `see the rows marked 'no'.`,
    );
  }
  return `${lines.join('\n')}\n`;
}
