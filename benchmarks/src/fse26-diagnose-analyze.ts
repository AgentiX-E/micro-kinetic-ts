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

import {
  DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  isOnsetShape,
  ONSET_SHAPES,
  POOL_METRIC_PREFIX,
} from '../../packages/tree/src/index.js';

import type { OnsetShape } from '../../packages/tree/src/index.js';

import { ONSET_FIELD_HALF_QUANTUM } from '../../packages/kinetic/src/benchmarks/fse26-diagnose.js';

import {
  caseOutcomes,
  discriminatorScreen,
  formatDiscriminatorReport,
} from './fse26-discriminator.js';
import {
  DEFAULT_SEPARATOR_CRITERION,
  formatSeparatorCensus,
  separatorCensus,
  sourceOf,
} from './fse26-separator.js';
import type { TermOracleOptions } from './fse26-term-oracle.js';
import {
  dominantFamily,
  formatTermOracleReport,
  isPoolDominantLabel,
  latencySlopes,
  onsetEarliness,
  onsetSlopes,
  shippedRank1,
  shippedScores,
} from './fse26-term-oracle.js';

/**
 * `latencySlopes`, `onsetEarliness` and `onsetSlopes` moved to `fse26-term-oracle.ts` —
 * the module that owns "rebuild a term from a dump" — so a screen here and the oracle
 * there cannot disagree about the engine: two implementations of one signal is the defect
 * this whole analyzer exists to find. Re-exported so every existing caller keeps its
 * import path.
 */
export { latencySlopes, onsetEarliness, onsetSlopes };

/**
 * The shape menu, re-exported rather than restated.
 *
 * It lives in the engine because the engine is what renders a shape, and it is
 * re-exported here because this module's callers — the screen, the tests — should not
 * have to know that. A second list would be a second menu, and the two would drift the
 * first time a shape was added: the screen would keep reporting rows for a shape the
 * ranking no longer implements.
 */
export { ONSET_SHAPES };

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
   * The failed-edge-direction score (the log score's INVERSE), or `undefined`
   * for a dump written before the engine reported it.
   *
   * Optional on purpose. A dump copied out of an older run has no such field,
   * and defaulting it to 0 would claim "this service was measured and credited
   * nothing" — a different statement from "this dump cannot answer that". The
   * analyzer exists to compare dumps across runs, so it has to read both.
   */
  readonly failedEdgeScore: number | undefined;
  /** Raw failed-edge records naming this service as the callee, or `undefined`. */
  readonly failedEdgeRecords: number | undefined;
  /** Largest inbound latency rise, or `undefined` when not recorded / not measured. */
  readonly latRise: number | undefined;
  /** Measured inbound edges, or `undefined` when the dump predates the field. */
  readonly latEdges: number | undefined;
  /**
   * Onset delay in ms after fault injection — the service's dominant metric's
   * first departure from its pre-injection baseline — or `undefined` when the
   * field is absent from the block or printed `-`.
   *
   * This is the dump's only TIME. Every other per-service field is a magnitude,
   * and magnitude is the axis the register has measured to exhaustion: the
   * source's median inbound rise in the latency-involved misses is 0.97, i.e.
   * no rise at all. Which service moved FIRST is a different quantity, and it is
   * the engine's own theory (collision at `t₀`, propagation `τ`).
   */
  readonly onsetDelayMs: number | undefined;
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
   * How many ERROR/FATAL lines carry BOTH source-signature flags, or `undefined`
   * when the block predates the field.
   *
   * The engine admits a line once, so the flood its log term divides by is
   * `|logic ∪ http| = logic + http − both`. Adding the two counts is not an
   * approximation of that union, it is a different quantity — and on the shipped
   * dump the difference reaches a factor of two on 109 services.
   *
   * Optional because a dump that predates it has no value for it, and the reader then
   * falls back to PROVING the union from `err`/`fatal`; it is never omitted because it
   * is zero.
   */
  readonly bothExceptionCount?: number | undefined;
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
  /**
   * The composition of the metric that drove this service's score, as the `metricDecisive` line
   * reports it, or `undefined` when the block has no composition for this service.
   *
   * A separate field from {@link metricOutcomes} because the composition has to exist for EVERY service
   * while the inventory is rendered only for the ground truth and the engine's predictions — and a term
   * built on the decisive composition has to be SIMULATED over every candidate a case could promote, so
   * the number cannot come from a line the block prints selectively.
   *
   * THE LINE IS NOW RENDERED FOR EVERY ROW, which it was not when this comment was written: the composition
   * is printed where the named metric carries one and `-` where it does not — the marker `onset`, `latRise`
   * and `dominant` already use — because a row that OMITS the line cannot tell a reader "this service's
   * dominant metric was not decomposed" apart from "this dump predates the line". Measured before the change
   * on `rcaeval-dumps/re1.txt` (run `35318624817`): present on **9991 of 11557** rows, and the 1566 without
   * it were exactly the rows whose inventory is not rendered either, so their absence was unattributable.
   * After it, the CHANNEL reaches every row and the composition reaches **86.45%** of them — two numbers,
   * and `scripts/dump_capability.py` reports both rather than folding them into one.
   *
   * `undefined` therefore means "no composition for this service": the block printed `-`, or it predates the
   * line entirely. The two provenances read as one value, exactly as they do for `onset`, and a section that
   * needs the difference counts the rows carrying a composition instead.
   */
  readonly decisiveOutcome: DiagnosedMetricOutcome | undefined;
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
  /**
   * The case's call-graph edges (`caller>callee`), or `undefined` for a dump
   * written before the line existed.
   *
   * Optional, and never defaulted to an empty array: "this dump recorded no graph"
   * and "this case has no edges" are different statements, and a structural
   * question answered from a defaulted empty graph would report every service as
   * unconnected — a fabricated answer rather than a missing one.
   */
  readonly edges: readonly string[] | undefined;
  /**
   * The case's fault-injection time (Unix ms), or `undefined` when the block does
   * not carry it. The anchor every {@link DiagnosedService.onsetDelayMs} is
   * measured from, and the gate the engine's temporal prior tests before it will
   * act at all.
   */
  readonly injectTimeMs: number | undefined;
  /**
   * How many decimals the block DECLARED its decimal fields were rendered with, or `undefined` when the
   * header does not carry the field — which is every dump written before it existed.
   *
   * Read here rather than assumed by every consumer: an ensemble's box is a property of the artifact, and a
   * consumer that reached for a constant would draw the cell of the dump it expected. `undefined` is
   * deliberately distinct from a stated value, and {@link dumpPrecisionOf} is the ONE place that turns the
   * two into a precision — with the historical fallback named there rather than inlined.
   */
  readonly fieldDecimals: number | undefined;
}

/**
 * The header line, with the render precision OPTIONAL and LAST.
 *
 * `decimals=` is what the producer declares its per-service fields were rounded to, and it is optional so
 * that a block written before the field parses exactly as it did — every dump that already exists is in that
 * state, the 141 MiB FSE/26 dump and all seven RCAEval dumps included. An absent field is NOT read as the
 * producer's current default: see {@link HISTORICAL_FIELD_DECIMALS}.
 */
const HEADER_RE =
  /^DIAG datapack=(\S+) faultType=(\S+) GT=\[([^\]]*)\] services=(\d+)(?: logMode=(\S+))?(?: inject=(\d+))?(?: decimals=(\d+))?$/;
/**
 * One service row.
 *
 * The id is `\S*`, not `\S+`, because a row with an EMPTY id is what the producer
 * writes for a candidate whose service label is missing — on the shipped dump that is
 * one row per case carrying the ten unlabelled `k8s.*` series. Requiring an id here
 * silently dropped that row, and the drop is not cosmetic: the engine's
 * `rankNormalizeScores` divides by `n - 1` over ITS candidate set, so a reader that
 * parses `n - 1` rows computes a different metric term for every service in the case.
 * The row also made the parsed count disagree with the header's `services=` — which
 * nothing checked until the guard on the `prediction=` line below.
 */
const SERVICE_RE =
  /^ {2}(\S*)(?: \[([^\]]*)\])? selfAnomaly=(\S+) logScore=(\S+)(?: failedEdge=(\S+) failedEdgeRecords=(\d+))?(?: latRise=(\S+) latEdges=(\d+))? dominant=(\S*) err=(\d+) fatal=(\d+) logic=(\d+) http=(\d+)(?: both=(\d+))?(?: onset=(\S+))?$/;
const PREDICTION_RE = /^ {2}prediction=\[([^\]]*)\]$/;
const EDGES_RE = /^ {2}edges=(.*)$/;
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
 * The decisive composition, one entry on a line of its own.
 *
 * `(.+)` rather than a shape check: the entry is validated by {@link parseTopEntry}, and a regex
 * that spelled the seven numbers out again would be a second owner of the same shape.
 */
const METRIC_DECISIVE_RE = /^ {4}metricDecisive: (.+)$/;

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

/**
 * Split a bracketed list into trimmed, non-empty entries.
 */
function parseList(body: string | undefined): string[] {
  if (body === undefined) return [];
  return body
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Parse one `label=score{dev=…,trend=…,cv=…,burst=…,rise=…,drop=…,base=…}` entry.
 *
 * The seven decomposition numbers must all be finite, or the entry is rejected whole — a partially
 * attached decomposition is worse than none, because it looks like a metric that genuinely carried
 * no decomposition. The SCORE is returned unvalidated: the shape line never uses it (the kept
 * scores come from `metricKept`), and the callers that do use it apply their own finiteness rule.
 *
 * @param entry - One space-separated entry from a composition line.
 * @returns The parsed outcome, or `undefined` when the entry does not parse.
 */
function parseTopEntry(entry: string): DiagnosedMetricOutcome | undefined {
  const m = TOP_ENTRY_RE.exec(entry);
  if (m === null) return undefined;
  const nums = [m[3], m[4], m[5], m[6], m[7], m[8], m[9]].map(Number);
  if (!nums.every((n) => Number.isFinite(n))) return undefined;
  return {
    label: m[1]!,
    outcome: 'kept',
    score: Number(m[2]),
    breakdown: {
      deviation: nums[0]!,
      trend: nums[1]!,
      cv: nums[2]!,
      burst: nums[3]!,
      riseRatio: nums[4]!,
      dropRatio: nums[5]!,
      baselineMean: nums[6]!,
    },
  };
}

/**
 * A service under construction.
 *
 * The metric lines trail the service line they belong to, so the outcome list
 * has to be appended to after the service has been read. Kept private: the only
 * thing that needs the mutable shape is the parser, and exposing it would let a
 * consumer mutate a parsed dump.
 */
interface MutableService extends Omit<DiagnosedService, 'metricOutcomes' | 'decisiveOutcome'> {
  metricOutcomes: DiagnosedMetricOutcome[] | undefined;
  decisiveOutcome: DiagnosedMetricOutcome | undefined;
}

/**
 * Strip the CI log transport's per-line prefix.
 *
 * A download is NOT the text the engine wrote: GitHub's job log prefixes EVERY line of stdout with
 * `YYYY-MM-DDTHH:MM:SS.fffffffZ `. The dump's grammar is column-anchored — `DIAG` at column 0, two
 * spaces for a service, four for a metric — so an unstripped log parses to ZERO cases, which is a
 * silent data gap that reads exactly like a run that produced nothing. Done once here rather than
 * at every pattern: a leading `\s*` in each of them would be a second, weaker definition of the
 * dump's indentation, and the indentation is what the parser is reading.
 *
 * Idempotent, because both forms live on this repo's disk: the saved fixtures are the stripped
 * form and a raw job log is the tagged one, and the same reader has to accept each.
 *
 * @param text - Raw log text, tagged or clean.
 * @returns The text with the transport prefix and the BOM removed.
 */
export function stripLogPrefix(text: string): string {
  // TWO passes, and the ORDER is load-bearing: the BOM sits BEFORE the timestamp, so a line that
  // carries one matches the timestamp pattern only after the BOM is gone. The BOM is also not a
  // file-head artefact — the transport writes one before the first line of every output CHUNK, so
  // `^\uFEFF` has to be multiline. Miss that and the line keeps a BOM the dump's grammar cannot
  // match: on run 35107871516, 13 of 1422 blocks had a BOM on a service row, each lost that row and
  // was dropped whole for a count mismatch — 0.9% of the population, 10 of them cases the run got
  // right, which is how the loss was noticed (the screen read 746 correct where the run published
  // 756). Each pattern has one job rather than one pattern doing both.
  return text.replace(/^\uFEFF/gm, '').replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/gm, '');
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
 * @param text - The log text (or any text containing `DIAG` blocks), tagged or clean.
 * @returns One entry per complete block, in file order.
 */
export function parseDiagnosticDump(text: string): DiagnosedCase[] {
  const lines = stripLogPrefix(text).split('\n');
  const cases: DiagnosedCase[] = [];
  let current:
    | {
        datapack: string;
        faultType: string;
        groundTruth: string[];
        logSignalMode: string;
        injectTimeMs: number | undefined;
        /** The header's declared render precision, or `undefined` when it predates the field. */
        fieldDecimals: number | undefined;
        services: MutableService[];
        /** The candidate count the header DECLARED, for the completeness check. */
        declaredServices: number;
        /** Filled by the `edges=` line, which may appear anywhere in the block. */
        edges: readonly string[] | undefined;
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

  for (const line of lines) {
    const header = HEADER_RE.exec(line);
    if (header) {
      // A new header without a footer means the previous block was truncated.
      finalizeOutcomes();
      current = {
        datapack: header[1]!,
        faultType: header[2]!,
        groundTruth: parseList(header[3]),
        logSignalMode: header[5] ?? '',
        // `undefined`, never 0, when the block omits it: 0 is the engine's own
        // spelling for "no anchor", and a screen that cannot tell the two apart
        // would report a temporal window for a case the engine left inert.
        injectTimeMs: header[6] === undefined ? undefined : Number(header[6]),
        // `undefined` when the header does not carry it, which is what every archived dump looks like — and
        // deliberately NOT defaulted here: the fallback is `HISTORICAL_FIELD_DECIMALS`, applied by
        // `dumpPrecisionOf`, so the reader never has to guess which of the two it is holding.
        fieldDecimals: header[7] === undefined ? undefined : Number(header[7]),
        services: [],
        declaredServices: Number(header[4]),
        edges: undefined,
      };
      lastService = undefined;
      declaredOutcomeCount = 0;
      openOutcomes = undefined;
      continue;
    }
    if (current === undefined) continue;

    const edges = EDGES_RE.exec(line);
    if (edges) {
      // `parseList` maps an empty body to `[]`, which is correct HERE: the line is
      // present, so the producer recorded a graph and it happens to be empty. The
      // absent line stays `undefined` and is never conflated with this.
      current.edges = parseList(edges[1]);
      continue;
    }

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
        // `undefined`, never 0, when the field is absent: the optional group
        // leaves both captures undefined together, so a dump from before this
        // field reads as unknown rather than as a measurement of zero.
        failedEdgeScore: service[5] === undefined ? undefined : Number(service[5]),
        failedEdgeRecords: service[6] === undefined ? undefined : Number(service[6]),
        // `-` is the producer's marker for "no caller measured a change", which is
        // not the same as a rise of 1, so it parses to `undefined` and not to a
        // number.
        latRise: service[7] === undefined || service[7] === '-' ? undefined : Number(service[7]),
        latEdges: service[8] === undefined ? undefined : Number(service[8]),
        dominantMetric: service[9] === '-' ? '' : service[9]!,
        errorCount: Number(service[10]),
        fatalCount: Number(service[11]),
        logicExceptionCount: Number(service[12]),
        httpExceptionCount: Number(service[13]),
        // The overlap of the two signature sets, and the reason the union is
        // recoverable at all. `undefined` on a dump that predates the field, which
        // is NOT the same claim as `0`: a zero overlap is a measurement of the
        // flood, while an absent one means the flood cannot be reconstructed — and
        // defaulting it to 0 would reproduce the exact double-count this field was
        // added to remove. `logSlopesForMode` refuses such a dump instead.
        bothExceptionCount: service[14] === undefined ? undefined : Number(service[14]),
        // The only TIME in the block: ms after injection, or `undefined` both
        // when the field is absent (a dump that predates it) and when it prints
        // `-` (measured and undetermined). Those are different provenances but
        // the same value to the temporal term, which omits both from its
        // earliness map; a section that needs the difference counts how many
        // services in the dump carry a NUMBER and reports that instead.
        onsetDelayMs:
          service[15] === undefined || service[15] === '-' ? undefined : Number(service[15]),
        metricOutcomes: undefined,
        decisiveOutcome: undefined,
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

    const decisive = METRIC_DECISIVE_RE.exec(line);
    if (decisive && lastService !== undefined) {
      // A single entry, so there is no declared count to guard: the line either parses whole or it
      // is ignored. The SCORE is checked here rather than in the parser because this is the one
      // place that reads it, and a `nonfinite` score is a block the inventory guard would reject
      // anyway — accepting it here would let the composition outlive the inventory it came from.
      const parsed = parseTopEntry(decisive[1]!);
      lastService.decisiveOutcome =
        parsed === undefined || !Number.isFinite(parsed.score) ? undefined : parsed;
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
        const m = parseTopEntry(entry);
        if (m === undefined || m.breakdown === undefined) continue;
        byLabel.set(m.label, m.breakdown);
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
      // A block whose parsed candidate count disagrees with its own header is
      // DROPPED, for the same reason a block with no `prediction=` line is: its service
      // list is known to be short, and a short list is not a smaller case — it is a
      // different `n`, which changes the metric term of every service in the case. An
      // absent case is visible in the totals; a wrong one is not.
      if (current.services.length === current.declaredServices) {
        cases.push({
          datapack: current.datapack,
          faultType: current.faultType,
          groundTruth: current.groundTruth,
          logSignalMode: current.logSignalMode,
          injectTimeMs: current.injectTimeMs,
          fieldDecimals: current.fieldDecimals,
          edges: current.edges,
          services: current.services,
          prediction: parseList(prediction[1]),
        });
      }
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

/**
 * One fault type's metric-guard census, with a control group.
 *
 * The engine discards most of a fault source's inventory — `transient-return` alone
 * removes 44% of the source side's metrics across the shipped dump's 666 misses,
 * against 24% of the winner's — and the tempting reading is "the guard is hiding the
 * fault". That reading is a POPULATION statement, and it cannot separate a cause from a
 * property of the population. The control is inside the same fault type: the cases the
 * engine already gets RIGHT. If the guard discards the source's signature just as often
 * there, the footprint is not what decides, whatever its size.
 *
 * Every field is read from the dump's rendered inventories and the dump's OWN outcome,
 * so no weight is needed and nothing is reconstructed.
 */
export interface GuardCensusRow {
  readonly faultType: string;
  readonly cases: number;
  readonly correct: number;
  /** Source side, over every case of this type. */
  readonly sourceKept: number;
  readonly sourceTransient: number;
  /**
   * The WRONG winner's — i.e. the rival's — kept and transient counts, over the wrong
   * cases only.
   *
   * Wrong cases only, because in a correct case the rank-1 service IS the source: a
   * column that mixed the two would add the source to its own comparison group and
   * wash out exactly the asymmetry it is meant to show.
   */
  readonly wrongWinnerKept: number;
  readonly wrongWinnerTransient: number;
  /** Source side, over the cases this type already gets right — the control. */
  readonly sourceKeptCorrect: number;
  readonly sourceTransientCorrect: number;
  /** Source side, over the cases it gets wrong. */
  readonly sourceKeptWrong: number;
  readonly sourceTransientWrong: number;
  /**
   * The source's strongest RENDERED deviation, median over each group.
   *
   * `undefined` when the group is empty — a median of no cases is not zero, and a
   * fabricated 0 reads as "the source showed no excursion".
   *
   * Rendered, because the block prints the decomposition only for the top few kept
   * metrics: this is a LOWER bound on the source's maximum deviation, and it is the
   * same bound on both sides of the comparison, which is what makes it usable.
   */
  readonly sourceBestDevCorrect: number | undefined;
  readonly sourceBestDevWrong: number | undefined;
  /**
   * The wrong winner's strongest rendered deviation, median over the wrong cases only.
   *
   * Not reported for the correct cases on purpose: there the winner IS the source, so
   * the column would compare a service with itself and print a structural zero as a
   * measurement.
   */
  readonly wrongWinnerBestDev: number | undefined;
}

/** The transient-return guard's word, as the engine writes it. */
const TRANSIENT_OUTCOME = 'transient-return';

/** The median of a possibly empty list, or `undefined` — never a fabricated 0. */
function medianOrUndefined(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Census a metric guard against the cases the engine already gets right.
 *
 * @param cases - Parsed cases; a case with no ground truth is skipped, since it has no
 *   source side to census.
 * @returns One row per fault type, most cases first.
 */
export function guardCensus(cases: readonly DiagnosedCase[]): GuardCensusRow[] {
  interface Acc {
    cases: number;
    correct: number;
    sourceKept: number;
    sourceTransient: number;
    wrongWinnerKept: number;
    wrongWinnerTransient: number;
    sourceKeptCorrect: number;
    sourceTransientCorrect: number;
    sourceKeptWrong: number;
    sourceTransientWrong: number;
    devCorrect: number[];
    devWrong: number[];
    devWrongWinner: number[];
  }
  const blank = (): Acc => ({
    cases: 0,
    correct: 0,
    sourceKept: 0,
    sourceTransient: 0,
    wrongWinnerKept: 0,
    wrongWinnerTransient: 0,
    sourceKeptCorrect: 0,
    sourceTransientCorrect: 0,
    sourceKeptWrong: 0,
    sourceTransientWrong: 0,
    devCorrect: [],
    devWrong: [],
    devWrongWinner: [],
  });
  /** A service's kept count, transient count and strongest rendered deviation. */
  const shape = (kase: DiagnosedCase, id: string) => {
    const service = kase.services.find((s) => s.serviceId === id);
    if (service === undefined || service.metricOutcomes === undefined) return undefined;
    let kept = 0;
    let transient = 0;
    let best = 0;
    for (const outcome of service.metricOutcomes) {
      if (outcome.outcome === TRANSIENT_OUTCOME) transient++;
      else if (outcome.outcome === 'kept') {
        kept++;
        const deviation = outcome.breakdown?.deviation ?? 0;
        if (deviation > best) best = deviation;
      }
    }
    return { kept, transient, best };
  };

  const byType = new Map<string, Acc>();
  for (const kase of cases) {
    // The source comes from ONE rule, shared with the separator screen. Taking
    // `groundTruth[0]` here and the most anomalous root there would let two documents
    // disagree about which service a case is about, with both of them looking measured.
    const sourceService = sourceOf(kase);
    if (sourceService === undefined) continue;
    const source = shape(kase, sourceService.serviceId);
    if (source === undefined) continue;
    const winnerId = kase.prediction[0] ?? '';
    const winner = winnerId === '' ? undefined : shape(kase, winnerId);
    const acc = byType.get(kase.faultType) ?? blank();
    const ok = isTop1Correct(kase);
    acc.cases++;
    acc.sourceKept += source.kept;
    acc.sourceTransient += source.transient;
    if (ok) {
      acc.correct++;
      acc.sourceKeptCorrect += source.kept;
      acc.sourceTransientCorrect += source.transient;
      acc.devCorrect.push(source.best);
    } else {
      acc.sourceKeptWrong += source.kept;
      acc.sourceTransientWrong += source.transient;
      acc.devWrong.push(source.best);
      // The rival's counts live in the WRONG branch only: in a correct case the rank-1
      // service is the source, so accumulating it here would add the source to its own
      // comparison group and wash out the asymmetry.
      if (winner !== undefined) {
        acc.wrongWinnerKept += winner.kept;
        acc.wrongWinnerTransient += winner.transient;
        acc.devWrongWinner.push(winner.best);
      }
    }
    byType.set(kase.faultType, acc);
  }

  return [...byType.entries()]
    .map(([faultType, acc]) => ({
      faultType,
      cases: acc.cases,
      correct: acc.correct,
      sourceKept: acc.sourceKept,
      sourceTransient: acc.sourceTransient,
      wrongWinnerKept: acc.wrongWinnerKept,
      wrongWinnerTransient: acc.wrongWinnerTransient,
      sourceKeptCorrect: acc.sourceKeptCorrect,
      sourceTransientCorrect: acc.sourceTransientCorrect,
      sourceKeptWrong: acc.sourceKeptWrong,
      sourceTransientWrong: acc.sourceTransientWrong,
      sourceBestDevCorrect: medianOrUndefined(acc.devCorrect),
      sourceBestDevWrong: medianOrUndefined(acc.devWrong),
      wrongWinnerBestDev: medianOrUndefined(acc.devWrongWinner),
    }))
    .sort((a, b) => b.cases - a.cases || (a.faultType < b.faultType ? -1 : 1));
}

/**
 * Render the guard census.
 *
 * The `Δ` column is the point of the section and it prints BESIDE both rates rather than
 * instead of them: a reader comparing 82% against 85% can see that the guard fires
 * almost always in BOTH groups, which no single "footprint" number conveys.
 *
 * @param rows - The census rows.
 * @returns The section text.
 */
export function formatGuardCensus(rows: readonly GuardCensusRow[]): string {
  const lines: string[] = [];
  lines.push('Metric-guard census — does a guard separate RIGHT from WRONG within a type?');
  const rate = (dropped: number, kept: number): string =>
    dropped + kept === 0 ? 'n/a' : `${((100 * dropped) / (dropped + kept)).toFixed(1)}%`;
  const dev = (value: number | undefined): string =>
    value === undefined ? 'n/a' : value.toFixed(2);
  lines.push(
    '  faultType'.padEnd(28) +
      'n=ok/all'.padStart(9) +
      '  source transient-drop'.padEnd(23) +
      'Δ vs ok'.padStart(9) +
      '  rival (wrong)'.padEnd(16) +
      'source best-dev wrong/ok'.padEnd(26) +
      'rival dev',
  );
  for (const row of rows) {
    const okRate = rate(row.sourceTransientCorrect, row.sourceKeptCorrect);
    const badRate = rate(row.sourceTransientWrong, row.sourceKeptWrong);
    const okTotal = row.sourceTransientCorrect + row.sourceKeptCorrect;
    const badTotal = row.sourceTransientWrong + row.sourceKeptWrong;
    const delta =
      okTotal === 0 || badTotal === 0
        ? 'n/a'
        : `${(
            (100 * row.sourceTransientWrong) / badTotal -
            (100 * row.sourceTransientCorrect) / okTotal
          ).toFixed(1)}pp`;
    lines.push(
      '  ' +
        row.faultType.padEnd(26) +
        `${row.correct}/${row.cases}`.padStart(9) +
        `  ${badRate} wrong / ${okRate} ok`.padEnd(23) +
        delta.padStart(9) +
        `  ${rate(row.wrongWinnerTransient, row.wrongWinnerKept)}`.padEnd(16) +
        `${dev(row.sourceBestDevWrong)} / ${dev(row.sourceBestDevCorrect)}`.padEnd(26) +
        dev(row.wrongWinnerBestDev),
    );
  }
  lines.push(
    '  A footprint that is the SAME in both groups is not a mechanism: it says the guard',
    '  fires on this fault type, not that firing is why the type fails. `n/a` is a group',
    '  with no cases, never a zero.',
  );
  return lines.join('\n');
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
/**
 * The weights the SHIPPED engine runs with, imported rather than restated.
 *
 * A diagnostic describes an engine, and if the numbers that describe it are typed out
 * here they can drift from the engine's own — which is precisely how this module came to
 * report the shipped signal's decisions as engine anomalies. There is now one of these per
 * shipped term, and `SHIPPED_TEMPORAL_WEIGHT` is the newest: a dump that carried the term
 * while a reconstruction omitted it would print the term's OWN decisions as the
 * instrument disagreeing with the engine, which is the defect this list exists to make
 * impossible.
 */
const SHIPPED_LAT_WEIGHT = DEFAULT_LAT_WEIGHT;
const SHIPPED_LAT_FLOOR = DEFAULT_LAT_MIN_RISE;
const SHIPPED_POOL_WEIGHT = DEFAULT_POOL_METRIC_PENALTY_WEIGHT;
const SHIPPED_TEMPORAL_WEIGHT = DEFAULT_TEMPORAL_WEIGHT;
const SHIPPED_ONSET_SHAPE = DEFAULT_ONSET_SHAPE;

/**
 * Which scored term decided a Top@1 miss.
 *
 * The engine's own order is `log1p(selfAnomaly) + logWeight × logScore` when the
 * other priors are off, and the dump carries both inputs — so every miss can be
 * ATTRIBUTED rather than guessed. Each value names a different defect, which is
 * why they are separate values and not one "wrong" bucket:
 *
 * - `metric` — the winner's own anomaly is higher. The ranking had nothing else
 *   to go on; the loss is an anomaly-signal problem.
 * - `log` — the winner's log score is higher. The engine saw error evidence
 *   pointing at the winner.
 * - `lat` — the winner's per-edge latency rise is higher. The engine saw a
 *   duration signal the error counts cannot express.
 * - a COMBINATION (`metric+log`, `metric+lat`, `log+lat`, `metric+log+lat`) — every
 *   listed term favours the winner. Spelled out rather than collapsed into one
 *   "both": with three terms, "both" stops saying which two, and whether the log is
 *   implicated at all changes what a reader does next.
 * - `tie` — the terms are equal, so the deterministic service-id tiebreak decided
 *   it. Not a signal failure; a missing discrimination.
 * - `unexplained` — NO MODELLED term explains the loss, i.e. the engine ordered a
 *   service below one with a strictly higher score on every term this report
 *   modelled. That is a defect in the engine or in the dump, never a modelling
 *   result. "Modelled" is load-bearing: the report prints which terms it used, and
 *   an unmodelled term's decisions land here, so a reader must check the banner
 *   before treating one as an engine finding. The temporal prior is MODELLED, so a
 *   `temporal` contribution is a finding about that term rather than about the engine.
 *   Read the SIGN, and read it precisely: positive means the term widened the WRONG
 *   winner's margin — it is working AGAINST the root in a case that is already a miss, so
 *   it is a barrier rather than a cause, and 35 of the 662 misses on the shipped dump have
 *   one. Negative means it argued FOR the root and the other terms outweighed it.
 *   Neither sign is the term's COST: that is `broken 0`, measured by
 *   `reconcileConfigurations` — a case that was correct at weight 0 and wrong at the
 *   shipped weight. A barrier in a lost case and a loss are different findings, and this
 *   vocabulary only has room for the first.
 * - `absent` — either service the attribution needs (the source or the winner) is
 *   missing from this dump's service list. The case cannot be attributed from this
 *   dump at all: the fields are reported as `NaN`, never 0, because a fabricated
 *   zero would read as "measured and credited nothing", which is a different
 *   statement and the wrong one to build a next step on.
 */
export type MissTerm = 'metric' | 'log' | 'lat' | 'pool' | 'temporal';

/**
 * Every attribution a case can receive, as ONE list the type is derived from.
 *
 * Derived rather than restated, because the alternative is two lists that must agree: a
 * spelling reachable by `classifyMiss` and absent here would be a label the report prints
 * and the tally drops, and nothing would fail. The test that walks all fifteen subsets of
 * the four terms is the census that keeps this list complete.
 *
 * The pool penalty is a term like the others HERE, unlike in the oracle's `TermName`: the
 * question is the same — how much did this term contribute to the winner's margin — and
 * for a penalty that is a number, `-weight × (indicator(winner) - indicator(source))`.
 * Positive means it subtracted from the ROOT, i.e. it is one of the reasons the root
 * lost; negative means it worked FOR the root, and it must not be named.
 */
export const MISS_DECIDED_BY = [
  // Generated from the term list, not hand-maintained: 2^5 - 1 = 31 names, and the
  // only thing a hand-written list of 31 does reliably is drift from the terms.
  // The test that walks every SUBSET of `MISS_TERMS` is what keeps this complete.
  'metric',
  'log',
  'lat',
  'pool',
  'temporal',
  'metric+log',
  'metric+lat',
  'metric+pool',
  'metric+temporal',
  'log+lat',
  'log+pool',
  'log+temporal',
  'lat+pool',
  'lat+temporal',
  'pool+temporal',
  'metric+log+lat',
  'metric+log+pool',
  'metric+log+temporal',
  'metric+lat+pool',
  'metric+lat+temporal',
  'metric+pool+temporal',
  'log+lat+pool',
  'log+lat+temporal',
  'log+pool+temporal',
  'lat+pool+temporal',
  'metric+log+lat+pool',
  'metric+log+lat+temporal',
  'metric+log+pool+temporal',
  'metric+lat+pool+temporal',
  'log+lat+pool+temporal',
  'metric+log+lat+pool+temporal',
] as const;

export type MissDecidedBy = (typeof MISS_DECIDED_BY)[number] | 'tie' | 'unexplained' | 'absent';

/** How one wrong case was decided. */
export interface MissClassification {
  readonly datapack: string;
  readonly faultType: string;
  readonly source: string;
  readonly winner: string | undefined;
  readonly decidedBy: MissDecidedBy;
  readonly sourceAnomaly: number;
  readonly winnerAnomaly: number;
  readonly sourceLog: number;
  readonly winnerLog: number;
  /**
   * Whether the service emitted any post-injection ERROR/FATAL line. The
   * distinction that matters for the silent-source block: a miss where NEITHER
   * side emits is a case the log signal structurally cannot decide, so it needs a
   * different signal rather than a reweighting.
   */
  readonly sourceEmits: boolean;
  readonly winnerEmits: boolean;
}

/** The priors a dump's DIAG blocks can be attributed with. */
export interface MissAttributionWeights {
  /**
   * The run's injection-anchored temporal pair.
   *
   * Here for the same reason as the latency and pool weights, one shipped term later: the
   * attribution decomposes the margin the WRONG winner had over the root, and a live term
   * missing from the decomposition makes a case whose real cause is that term read as
   * `unexplained` — i.e. as an engine defect. Defaults to the shipped pair, so a reader
   * diagnosing the shipped engine gets the shipped engine; `temporalWeight: 0` is the
   * explicit ablation and it is a DIFFERENT report.
   */
  readonly temporalWeight?: number;
  readonly onsetShape?: OnsetShape;
  /**
   * The run's log weight. Required, because its SCALE decides the attribution and
   * a defaulted one would attribute losses at a scale the run never used.
   */
  readonly logWeight: number;
  /**
   * The run's per-edge latency weight. Defaults to the SHIPPED constant.
   *
   * There is no "absent" spelling: the dump carries `latRise` and `latEdges`, so
   * the term is attributable, and a reader diagnosing the shipped engine gets the
   * shipped engine. `0` is the explicit two-term ablation.
   */
  readonly latWeight?: number;
  /** The run's latency rise floor. Defaults to the shipped constant. */
  readonly latFloor?: number;
  /**
   * The run's pool-dominance penalty. Defaults to the SHIPPED constant, and there is no
   * "absent" spelling for the same reason as the latency weight: the dump carries the
   * dominant metric, so the term is attributable, and a reader diagnosing the shipped
   * engine must get the shipped engine. `0` is the explicit three-term ablation.
   */
  readonly poolWeight?: number;
}

/** Float tolerance for "the two scores are equal". */
const SCORE_EPSILON = 1e-9;

/** Whether a service carries any post-injection error evidence. */
function emits(service: DiagnosedService): boolean {
  return service.errorCount + service.fatalCount + service.logicExceptionCount > 0;
}

/**
 * The order the miss kinds are reported and tallied in: the combinations first, in the
 * order `MISS_DECIDED_BY` fixes, then the three that are not a set of terms.
 */
export const MISS_ORDER: readonly MissDecidedBy[] = [
  ...MISS_DECIDED_BY,
  'tie',
  'unexplained',
  'absent',
];

/** The terms a classification can name, in the order they are spelled out. */
const MISS_TERMS: readonly MissTerm[] = ['metric', 'log', 'lat', 'pool', 'temporal'];

/**
 * Attribute a case's Top@1 miss.
 *
 * Models every term the dump carries: `selfAnomaly`, `logScore` and the per-edge
 * latency rise (`latRise`/`latEdges`). The last of those is the reason this
 * function changed — the dump grew that field for the latency term, and this
 * comparison was not extended with it, so the shipped signal's own decisions were
 * reported as `unexplained` (12 of 672 misses on the shipped configuration, all
 * twelve explained by the latency term once it was modelled). A diagnostic that
 * does not model the configuration it is diagnosing is not conservative; it is
 * wrong, and it was wrong in the direction that sends a reader to fix the engine.
 *
 * Still exact only for a run whose non-zero priors are among the modelled ones,
 * which is why `weights` also names the LATENCY weight and the rise floor, and
 * why the report prints them: `unexplained` is a claim about the modelled terms.
 *
 * @param kase - One parsed case.
 * @param weights - The run's log weight, latency weight and rise floor.
 * @returns One classification, or `[]` when Top@1 was already correct.
 */
export function classifyMiss(
  kase: DiagnosedCase,
  weights: MissAttributionWeights,
): MissClassification[] {
  if (isTop1Correct(kase)) return [];

  const winner = kase.prediction[0];
  const source = kase.groundTruth[0] ?? '';
  const byId = new Map(kase.services.map((s) => [s.serviceId, s]));
  const win = winner === undefined ? undefined : byId.get(winner);
  const src = byId.get(source);

  // Attribution needs BOTH services. If either is missing the case cannot be
  // attributed from this dump, and every field it would have contributed is
  // reported as `NaN` — never as 0, which would read as a measurement.
  if (src === undefined || win === undefined) {
    return [
      {
        datapack: kase.datapack,
        faultType: kase.faultType,
        source,
        winner,
        decidedBy: 'absent',
        sourceAnomaly: src?.selfAnomaly ?? Number.NaN,
        winnerAnomaly: win?.selfAnomaly ?? Number.NaN,
        sourceLog: src?.logScore ?? Number.NaN,
        winnerLog: win?.logScore ?? Number.NaN,
        sourceEmits: src === undefined ? false : emits(src),
        winnerEmits: win === undefined ? false : emits(win),
      },
    ];
  }

  // Both services are known from here on, so every term below is read from a real
  // row and no fallback exists that coverage could never reach.
  const latWeight = weights.latWeight ?? SHIPPED_LAT_WEIGHT;
  const latSlopes = latencySlopes(kase.services, weights.latFloor ?? SHIPPED_LAT_FLOOR);
  const latOf = (serviceId: string) => latSlopes.get(serviceId) ?? 0;
  const poolWeight = weights.poolWeight ?? SHIPPED_POOL_WEIGHT;

  // Every term is a contribution to the WINNER's margin over the source, the pool
  // penalty included — and there it is a difference of indicators, not of magnitudes:
  // the term depends on WHICH metric won a service's anomaly maximum, so a service
  // whose dominant metric was never measured is not penalised (the engine's own rule).
  const poolIndicator = (service: { dominantMetric: string }): number =>
    isPoolDominantLabel(service.dominantMetric) ? 1 : 0;

  const onset = onsetSlopes(kase, weights.onsetShape ?? SHIPPED_ONSET_SHAPE);
  const temporalWeight = weights.temporalWeight ?? SHIPPED_TEMPORAL_WEIGHT;

  const parts: Record<MissTerm, number> = {
    metric: Math.log1p(win.selfAnomaly) - Math.log1p(src.selfAnomaly),
    log: weights.logWeight * (win.logScore - src.logScore),
    lat: latWeight * (latOf(winner!) - latOf(source)),
    pool: -poolWeight * (poolIndicator(win) - poolIndicator(src)),
    // The temporal term credits the FIRST MOVER, so its contribution to the winner's
    // margin is a difference of two slopes — `w·(slope(winner) − slope(root))`. Positive
    // means it widened the wrong winner's margin, i.e. it is working AGAINST the root; that
    // is a barrier in a case already lost, NOT a loss, and the distinction matters because
    // the count is large (35 of 662 on the shipped dump) while the term's realized cost is
    // zero. Negative means it argued for the root and the other terms outweighed it.
    temporal: temporalWeight * ((onset.get(winner!) ?? 0) - (onset.get(source) ?? 0)),
  };
  const gap = MISS_TERMS.reduce((sum, term) => sum + parts[term], 0);

  let decidedBy: MissDecidedBy;
  if (Math.abs(gap) <= SCORE_EPSILON) decidedBy = 'tie';
  else if (gap < 0) decidedBy = 'unexplained';
  else decidedBy = MISS_TERMS.filter((term) => parts[term] > 0).join('+') as MissDecidedBy;

  return [
    {
      datapack: kase.datapack,
      faultType: kase.faultType,
      source,
      winner,
      decidedBy,
      sourceAnomaly: src.selfAnomaly,
      winnerAnomaly: win.selfAnomaly,
      sourceLog: src.logScore,
      winnerLog: win.logScore,
      sourceEmits: emits(src),
      winnerEmits: emits(win),
    },
  ];
}

/**
 * Attribute every Top@1 miss in a dump.
 *
 * Reports the silent-both-sides count separately from the total: a miss where
 * neither the source nor the winner emits is the block no reweighting can move,
 * so that is the number which decides whether a log-side fix is the right next
 * move at all.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @returns The classifications, with the tallies.
 */
export function tallyMisses(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
): {
  readonly total: number;
  readonly byDecidedBy: ReadonlyMap<MissDecidedBy, number>;
  readonly silentBothSides: number;
  readonly classifications: readonly MissClassification[];
} {
  const classifications = cases.flatMap((kase) => classifyMiss(kase, weights));
  const byDecidedBy = new Map<MissDecidedBy, number>();
  let silentBothSides = 0;
  for (const c of classifications) {
    byDecidedBy.set(c.decidedBy, (byDecidedBy.get(c.decidedBy) ?? 0) + 1);
    if (!c.sourceEmits && !c.winnerEmits) silentBothSides += 1;
  }
  return { total: classifications.length, byDecidedBy, silentBothSides, classifications };
}

/**
 * The dump's recorded ranking and the modelled one, reconciled case by case.
 *
 * A dump does not record the weights it was scored at, so the only way to know
 * whether the flags on the command line are the dump's own is to MEASURE it: rank
 * every case at the modelled weights and compare with the recorded rank-1. The
 * comparison is what makes the four numbers below a reconciliation rather than a
 * pair of assertions — at the dump's own configuration `fixed`, `broken` and
 * `rank1Moved` are all zero and the two `correct` counts are one number.
 *
 * `broken` is the one a headline hides. The pool penalty's published figure is a net
 * (+6) and a per-type split; the case-level cost it paid for it was never printed,
 * and the attribution could not show it at all, because a case the modelled weights
 * BREAK is not a recorded miss and therefore never reaches {@link classifyMiss}.
 */
export interface ConfigReconciliation {
  /** Cases carrying at least one non-empty ground-truth label. */
  readonly scorable: number;
  /** Correct under the dump's own recorded rank-1. */
  readonly recordedCorrect: number;
  /** Correct under the modelled weights' rank-1. */
  readonly modelledCorrect: number;
  /** Correct in both: the population no configuration change touches. */
  readonly bothCorrect: number;
  /** Wrong in both. */
  readonly bothWrong: number;
  /** Recorded-wrong → modelled-correct. */
  readonly fixed: number;
  /** Recorded-correct → modelled-wrong. */
  readonly broken: number;
  /** `modelledCorrect − recordedCorrect`; the headline, and the least of these. */
  readonly net: number;
  /** Cases whose rank-1 the modelled weights move, correct or not. */
  readonly rank1Moved: number;
}

/**
 * Reconcile the modelled weights against a dump's recorded ranking.
 *
 * @param cases - Parsed cases.
 * @param weights - The modelled weights.
 * @returns The cross-tabulation.
 */
export function reconcileConfigurations(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
): ConfigReconciliation {
  let scorable = 0;
  let bothCorrect = 0;
  let bothWrong = 0;
  let fixed = 0;
  let broken = 0;
  let rank1Moved = 0;
  for (const kase of cases) {
    if (!kase.groundTruth.some((name) => name !== '')) continue;
    scorable++;
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    const recorded = kase.prediction[0] !== undefined && root.has(kase.prediction[0]);
    const modelledTop = shippedRank1(kase, {
      logWeight: weights.logWeight,
      latWeight: weights.latWeight ?? SHIPPED_LAT_WEIGHT,
      latFloor: weights.latFloor ?? SHIPPED_LAT_FLOOR,
      poolWeight: weights.poolWeight ?? SHIPPED_POOL_WEIGHT,
      temporalWeight: weights.temporalWeight ?? SHIPPED_TEMPORAL_WEIGHT,
      onsetShape: weights.onsetShape ?? SHIPPED_ONSET_SHAPE,
    });
    const modelled = modelledTop !== undefined && root.has(modelledTop);
    if (modelledTop !== kase.prediction[0]) rank1Moved++;
    if (recorded && modelled) bothCorrect++;
    else if (!recorded && !modelled) bothWrong++;
    else if (modelled) fixed++;
    else broken++;
  }
  const recordedCorrect = bothCorrect + broken;
  const modelledCorrect = bothCorrect + fixed;
  return {
    scorable,
    recordedCorrect,
    modelledCorrect,
    bothCorrect,
    bothWrong,
    fixed,
    broken,
    net: modelledCorrect - recordedCorrect,
    rank1Moved,
  };
}

/** Render the recorded-vs-modelled reconciliation as two lines. */
function formatReconciliation(reconciled: ConfigReconciliation): string[] {
  return [
    `  configuration vs the dump's recorded rank-1 (${reconciled.scorable} cases): ` +
      `both-correct ${reconciled.bothCorrect}  both-wrong ${reconciled.bothWrong}  ` +
      `fixed ${reconciled.fixed}  broken ${reconciled.broken}  net ${reconciled.net >= 0 ? '+' : ''}${reconciled.net}`,
    `  correct: recorded ${reconciled.recordedCorrect} / modelled ${reconciled.modelledCorrect}; ` +
      `rank-1 moved ${reconciled.rank1Moved}`,
  ];
}

/**
 * Render the miss attribution over a whole dump.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @returns One multi-line report, without a trailing newline.
 */
export function formatMissReport(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
): string {
  const { total, byDecidedBy, silentBothSides, classifications } = tallyMisses(cases, weights);
  const lines: string[] = [];
  // The banner names every modelled term, because `unexplained` is a claim about
  // THEM and not about the engine. A reader who skipped this line once spent a
  // session treating the shipped signal's own decisions as twelve engine bugs.
  const latWeight = weights.latWeight ?? SHIPPED_LAT_WEIGHT;
  const modelled =
    latWeight === 0
      ? 'latency term NOT modelled (--lat-weight 0)'
      : `latWeight=${latWeight}; latFloor=${weights.latFloor ?? SHIPPED_LAT_FLOOR}`;
  const poolWeight = weights.poolWeight ?? SHIPPED_POOL_WEIGHT;
  // The pool term is named on the same rule as the latency one: an ablation that left
  // this clause reading like the shipped configuration would make the banner — and with
  // it every `unexplained` claim — false.
  const poolModelled =
    poolWeight === 0 ? 'pool penalty NOT modelled (--pool-penalty 0)' : `poolWeight=${poolWeight}`;
  const temporalWeight = weights.temporalWeight ?? SHIPPED_TEMPORAL_WEIGHT;
  // Named on the same rule as the other two, and it needs BOTH halves: a weight quoted
  // without the shape it was measured on is not a configuration, so an ablation typed in
  // one of them and left in the other would print a banner nobody could reproduce.
  const temporalModelled =
    temporalWeight === 0
      ? 'temporal prior NOT modelled (--temporal-weight 0)'
      : `temporalWeight=${temporalWeight}; onsetShape=${weights.onsetShape ?? SHIPPED_ONSET_SHAPE}`;
  lines.push(
    `Miss attribution (logWeight=${weights.logWeight}; ${modelled}; ${poolModelled}; ` +
      `${temporalModelled}; exact only when no other prior is on):`,
  );
  // Two counts, because they are two different questions and the report used to
  // answer both with one number while its own mode pre-screen answered the second
  // with another: `wrong cases` is the DUMP's recorded ranking (the thing the engine
  // actually did and the set `classifyMiss` attributes), `modelled` is the
  // configuration on the banner. They are equal exactly when the flags are the
  // dump's own, which `rank-1 moved` below measures rather than assumes.
  const reconciled = reconcileConfigurations(cases, weights);
  lines.push(`  wrong cases: ${total} (the dump's recorded rank-1)`);
  lines.push(...formatReconciliation(reconciled));
  for (const kind of MISS_ORDER) {
    const n = byDecidedBy.get(kind) ?? 0;
    if (n > 0) lines.push(`  ${kind.padEnd(12)} ${n}`);
  }
  const unexplained = byDecidedBy.get('unexplained') ?? 0;
  if (unexplained > 0 && reconciled.rank1Moved > 0) {
    // The invariant is "a healthy engine has zero `unexplained`", and it is a claim
    // about the modelled terms AT THE DUMP'S OWN CONFIGURATION. Once the weights move
    // the rank-1, every case they would flip reads as `unexplained` — the pool penalty
    // produced 14 of them on a pool-off dump, none of them an engine finding. Say so
    // next to the number, because the count alone invites the opposite reading.
    lines.push(
      `  note: ${unexplained} \`unexplained\` and ${reconciled.fixed} \`fixed\` are two footprints of ` +
        `the same difference — the modelled weights move the rank-1 in ${reconciled.rank1Moved} cases. ` +
        'At the dump’s own configuration both are zero and the category is a defect claim.',
    );
  }
  lines.push(`  silent both sides (no error evidence either side): ${silentBothSides}`);

  const byType = new Map<string, MissClassification[]>();
  for (const c of classifications) {
    const list = byType.get(c.faultType);
    if (list) list.push(c);
    else byType.set(c.faultType, [c]);
  }
  for (const [faultType, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    const counts = new Map<MissDecidedBy, number>();
    let silent = 0;
    for (const c of list) {
      counts.set(c.decidedBy, (counts.get(c.decidedBy) ?? 0) + 1);
      if (!c.sourceEmits && !c.winnerEmits) silent += 1;
    }
    const parts = MISS_ORDER.filter((k) => (counts.get(k) ?? 0) > 0).map(
      (k) => `${k}=${counts.get(k)}`,
    );
    lines.push(
      `  ${faultType.padEnd(26)} wrong=${list.length} silent=${silent} ${parts.join(' ')}`,
    );
  }
  return lines.join('\n');
}

/**
 * One case's requirement on a weight.
 *
 * Every candidate's score is affine in the weight — `base + w × slope` — which is
 * what makes a sweep PREDICTABLE rather than something to run. For the shipped
 * formula the base is `log1p(selfAnomaly) + logWeight × logScore` and the slope is
 * the new signal's score, so a control dump (weight 0) already carries everything
 * needed to say whether any weight could work.
 */
export interface WeightSeparationCase {
  /** Case identifier, so the binding case can be named. */
  readonly datapack: string;
  /**
   * The services ANY of which may end up at rank 1.
   *
   * A list rather than one name, because the benchmark's own labels are a list:
   * every FSE'26 network-fault case names two acceptable roots (`mysql` plus the
   * service it is co-located with). Requiring `groundTruth[0]` specifically would
   * demand a ranking the benchmark never asked for, and would report a
   * correctly-ranked case as unsatisfiable — it did, for 42 of 97
   * `NetworkPartition` cases in one measured dump, which is how this was found.
   */
  readonly targets: readonly string[];
  /** Per-service affine score, `base` at `w = 0` and `slope` as the coefficient. */
  readonly scores: ReadonlyMap<string, { readonly base: number; readonly slope: number }>;
  /**
   * The services whose `slope` is a MEASUREMENT, stated by a builder whose term can leave some of
   * them unweighed.
   *
   * `slope` alone cannot answer the question the window's own classes ask — "is this pair EQUAL
   * because the term read the same number twice, or because it read nothing at all?" — because both
   * arrive as `0`. The first is a pair the ENGINE resolves on the unrounded field, so a case blocked
   * by it is blocked by the artifact's resolution; the second is a pair the engine cannot separate
   * either, because its own map has no entry and its consumer reads that as zero. Two different
   * findings, two different fixes, and only the builder can say which.
   *
   * ABSENT means the caller makes no claim about a rendered tie: the window then attributes an equal
   * pair the way it did before this field existed, and the satisfied side's {@link
   * UnrepresentableFrontier} stays empty rather than guessing. The `failedEdge` and `lat` producers
   * omit it; the decisive-stability screen states it.
   */
  readonly weighed?: ReadonlySet<string>;
}

/** The interval of weights, if any, at which EVERY case puts its target first. */
export interface WeightSeparation {
  readonly cases: number;
  /** The smallest weight that satisfies every case. */
  readonly requiredMin: number;
  /** The largest weight that satisfies every case (may be `Infinity`). */
  readonly allowedMax: number;
  /** Whether a single weight exists. False means no sweep can pass. */
  readonly separable: boolean;
  /** The case that demands the largest minimum — the binding lower bound. */
  readonly bindingMin: string | undefined;
  /** The case that permits the smallest maximum — the binding upper bound. */
  readonly bindingMax: string | undefined;
}

/**
 * Which signal's score is the coefficient of the weight being solved for.
 *
 * A selector rather than a map, because the two terms live in the same dump and
 * only one of them is ever the subject of a question: the solver answers "does a
 * weight exist" for ONE term at a time, and passing a precomputed map would let a
 * caller mix them.
 */
export type SlopeKind = 'failedEdge' | 'lat';

/** Float tolerance for a zero coefficient or a zero gap. */
const WEIGHT_EPSILON = 1e-12;

/** A closed interval of weights. */
export interface WeightInterval {
  readonly min: number;
  readonly max: number;
}

/**
 * The interval of weights at which ONE named service is at rank 1.
 *
 * Solved exactly rather than sampled: for each competitor the requirement
 * `base_t + w·slope_t >= base_k + w·slope_k` is linear in `w`, so the interval is
 * the intersection of at most one half-line per competitor. A competitor with a
 * larger slope caps `w`; one with a smaller slope floors it; one with the same
 * slope either never wins or is an unconditional blocker.
 *
 * @param scores - The case's affine scores.
 * @param target - The service that must be first.
 * @returns The interval, or `undefined` when the service is not described or is
 *   never first.
 */
function targetInterval(
  scores: WeightSeparationCase['scores'],
  target: string,
): WeightInterval | undefined {
  const t = scores.get(target);
  // A target the dump does not describe cannot be satisfied by ANY weight. The
  // caller must not read that as "unconstrained" — the aggregate would then claim
  // separability on the strength of a case it never read.
  if (t === undefined) return undefined;

  let min = 0;
  let max = Number.POSITIVE_INFINITY;
  for (const [service, other] of scores) {
    if (service === target) continue;
    const slopeGap = t.slope - other.slope;
    const baseGap = other.base - t.base;
    if (slopeGap > WEIGHT_EPSILON) {
      // Raising the weight helps the target against this competitor.
      min = Math.max(min, baseGap / slopeGap);
    } else if (slopeGap < -WEIGHT_EPSILON) {
      // Raising the weight hurts it: this competitor caps the weight.
      max = Math.min(max, baseGap / slopeGap);
    } else if (baseGap > 0) {
      // Equal slopes and the competitor is ahead at every weight: the target can
      // never be rank 1, so the case excludes every weight. Reported as an empty
      // interval rather than as a large number, so a caller cannot mistake it for
      // a satisfiable constraint.
      max = Number.NEGATIVE_INFINITY;
    }
  }
  return { min, max };
}

/** Merge ascending intervals, joining any pair that touches. */
function mergeIntervals(sorted: readonly WeightInterval[]): WeightInterval[] {
  const merged: WeightInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.min <= last.max + WEIGHT_EPSILON) {
      merged[merged.length - 1] = { min: last.min, max: Math.max(last.max, interval.max) };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/**
 * The set of weights at which one case is satisfied.
 *
 * A LIST, not one interval, because a case is satisfied by ANY of its acceptable
 * roots and the union of their intervals need not be an interval: two roots can
 * each be first over disjoint weight ranges. Collapsing that to a single interval
 * would silently claim the gap between them, so a caller reading the gap as
 * feasible would measure a weight this method had no evidence for.
 *
 * @param one - The case.
 * @returns Disjoint intervals in ascending order; EMPTY when no weight satisfies
 *   the case, which is the honest answer for a case the dump does not describe.
 */
export function caseWeightInterval(one: WeightSeparationCase): readonly WeightInterval[] {
  const intervals: WeightInterval[] = [];
  for (const name of one.targets) {
    const interval = targetInterval(one.scores, name);
    // `min > max` is `targetInterval`'s empty set: a root that can never be first.
    if (interval === undefined || interval.min > interval.max) continue;
    intervals.push(interval);
  }
  intervals.sort((a, b) => a.min - b.min);
  return mergeIntervals(intervals);
}

/**
 * Whether a single weight satisfies every case at once.
 *
 * This is the cheap substitute for a weight sweep. A sweep over `k` weights costs
 * `k` full benchmark runs; this costs nothing, because the dump already carries
 * both terms. It answers only the QUESTION a sweep would answer — "does a weight
 * exist that keeps every case?" — and not what that weight would do to cases that
 * are currently wrong for other reasons, so it can prove a sweep is futile and
 * cannot prove one is sufficient. That asymmetry is the point: it is a
 * falsifier.
 *
 * @param cases - One entry per case that the weight is supposed to move.
 * @returns The aggregate interval and whether it is non-empty.
 */
export function computeWeightSeparation(cases: readonly WeightSeparationCase[]): WeightSeparation {
  let requiredMin = 0;
  let allowedMax = Number.POSITIVE_INFINITY;
  let bindingMin: string | undefined;
  let bindingMax: string | undefined;
  // The feasible set is the INTERSECTION of the cases' sets, and an intersection of
  // unions is not described by its extremes: two cases can each allow disjoint
  // ranges whose overlap is empty while the extremes still look compatible. So the
  // verdict comes from folding the sets, and the extremes are reported as bounds.
  let feasible: readonly WeightInterval[] = [{ min: 0, max: Number.POSITIVE_INFINITY }];
  for (const one of cases) {
    const allowed = caseWeightInterval(one);
    const next: WeightInterval[] = [];
    for (const have of feasible) {
      for (const want of allowed) {
        const lo = Math.max(have.min, want.min);
        const hi = Math.min(have.max, want.max);
        if (lo <= hi) next.push({ min: lo, max: hi });
      }
    }
    next.sort((a, b) => a.min - b.min);
    feasible = mergeIntervals(next);
    // The earliest weight this case permits, and the latest: `allowed` is ascending
    // and a case with no feasible weight at all contributes an empty extreme, which
    // is what makes the aggregate unsatisfiable rather than merely narrow.
    const lo = allowed[0]?.min ?? Number.POSITIVE_INFINITY;
    const hi = allowed[allowed.length - 1]?.max ?? Number.NEGATIVE_INFINITY;
    if (lo > requiredMin) {
      requiredMin = lo;
      bindingMin = one.datapack;
    }
    if (hi < allowedMax) {
      allowedMax = hi;
      bindingMax = one.datapack;
    }
  }
  return {
    cases: cases.length,
    requiredMin,
    allowedMax,
    separable: feasible.length > 0,
    bindingMin,
    bindingMax,
  };
}

/**
 * Build the solver's input from parsed cases, for the shipped score formula.
 *
 * The base is `log1p(selfAnomaly) + logWeight × logScore` and the slope is the
 * selected term's score, so a dump from a run with the term OFF still predicts what
 * turning it on would do — which is what makes the control run sufficient and the
 * sweep unnecessary.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @param slope - Which term's score is the coefficient. Defaults to `failedEdge`,
 *   the term this solver was built for, so existing callers are unaffected.
 * @param latFloor - Rise a service must clear before the latency term credits it,
 *   when `slope` is `lat`. Default 1 = the shipped shape.
 * @returns One entry per case whose target the dump describes.
 */
export function buildWeightSeparationCases(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
  slope: SlopeKind = 'failedEdge',
  latFloor = 1,
): WeightSeparationCase[] {
  const built: WeightSeparationCase[] = [];
  for (const kase of cases) {
    // EVERY acceptable root, not the first: the benchmark's labels are a list and
    // the engine is correct when it ranks any of them first.
    const targets = kase.groundTruth.filter((name) => name !== '');
    if (targets.length === 0) continue;
    // Computed once per case, not per service: the latency term is max-normalised
    // ACROSS the case, so a per-service call would divide by a per-service maximum.
    const lat = slope === 'lat' ? latencySlopes(kase.services, latFloor) : undefined;
    const scores = new Map<string, { base: number; slope: number }>();
    for (const service of kase.services) {
      scores.set(service.serviceId, {
        base: Math.log1p(service.selfAnomaly) + weights.logWeight * service.logScore,
        slope:
          lat === undefined ? (service.failedEdgeScore ?? 0) : (lat.get(service.serviceId) ?? 0),
      });
    }
    built.push({ datapack: kase.datapack, targets, scores });
  }
  return built;
}

/**
 * Render {@link computeWeightSeparation} as a report.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @returns One multi-line report, without a trailing newline.
 */
export function formatWeightSeparationReport(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
  slope: SlopeKind = 'failedEdge',
): string {
  const report = computeWeightSeparation(buildWeightSeparationCases(cases, weights, slope));
  const lines: string[] = [];
  lines.push(
    `Weight separation (slope=${slope}; logWeight=${weights.logWeight}; solved from the dump, no sweep needed):`,
  );
  lines.push(`  cases the weight is supposed to satisfy: ${report.cases}`);
  // Four distinct meanings, and collapsing any two would misreport the verdict: a
  // finite bound, no cap at all (`+Infinity` on the cap), and "no weight works"
  // (`+Infinity` on the floor, or `-Infinity` on the cap, which is what an
  // unsatisfiable case contributes). A non-finite FLOOR printed as a number would
  // be worse than useless — `Infinity` reads as a very large weight, and the old
  // rendering of an unsatisfiable case showed `0.000`, which reads as "w = 0
  // satisfies this", the opposite of what the case says.
  const floor = Number.isFinite(report.requiredMin)
    ? report.requiredMin.toFixed(3)
    : 'none — no weight is enough for every case';
  const cap =
    report.allowedMax === Number.POSITIVE_INFINITY
      ? 'unbounded'
      : report.allowedMax === Number.NEGATIVE_INFINITY
        ? 'none — some case is unsatisfiable at every weight'
        : report.allowedMax.toFixed(3);
  lines.push(`  required min weight: ${floor}`);
  lines.push(`  allowed max weight:  ${cap}`);
  lines.push(`  separable: ${report.separable ? 'YES' : 'NO'}`);
  if (!report.separable) {
    // Two shapes, and they need different sentences. A genuine conflict has two
    // finite bounds with the floor above the cap, and naming both binders is the
    // useful statement. An unsatisfiable case has NO numeric bound, so the
    // comparison form would print the two infinities and read as if a weight
    // existed — the opposite of the verdict it is meant to convey.
    // Both names are guaranteed on this path, and the assertion records WHY rather
    // than papering over a gap: an inseparable report either has a finite conflict —
    // and a finite bound is always set by some case — or a case that admits no
    // weight, which is itself the floor's binder. The fields stay optional on the
    // interface only because a SEPARABLE report has no binders to name.
    const minName = report.bindingMin as string;
    const maxName = report.bindingMax as string;
    if (Number.isFinite(report.requiredMin) && Number.isFinite(report.allowedMax)) {
      lines.push(
        `  binding cases: needs ${floor} for ${minName}, but only ${cap} before ${maxName} breaks`,
      );
    } else {
      lines.push(`  binding cases: ${minName} admits no weight at all, so no sweep can pass`);
    }
  }
  return lines.join('\n');
}

/**
 * Weights at which NO case that is correct today becomes incorrect.
 *
 * ## Why this is not {@link computeWeightSeparation}
 *
 * The two are easy to confuse and they answer different questions:
 *
 * - `computeWeightSeparation` asks *"is there a weight at which EVERY case is
 *   satisfied?"*. One case that no weight can satisfy makes it say NO, and on the
 *   per-edge latency slope that is exactly what it says — `separable: NO`,
 *   `cases: 1380` — even though a weight at which nothing gets worse plainly
 *   exists.
 * - This asks *"is there a weight at which no case gets WORSE?"*, which is the
 *   question the kill criterion asks. A case that is already wrong cannot get
 *   worse, so it constrains nothing here; it is only a candidate to be GAINED.
 *
 * A wrong negative on the first question is not a curiosity: the register cited the
 * window below as the reason the latency axis could be reopened, and no shipped
 * instrument could compute it. The report therefore names which question it
 * answered, and the CLI flag that prints it is separate.
 *
 * ## The algebra
 *
 * `score(v) = base(v) + w·slope(v)` with `base = log1p(selfAnomaly) +
 * logWeight·logScore`, so for each competitor the requirement is linear in `w` and
 * a case's feasible set is a union of intervals ({@link caseWeightInterval}).
 * Intersecting that union over every currently-correct case leaves the interval
 * containing 0; its right end is the cap.
 */
export interface ZeroRegressionWindow {
  /** Cases the dump describes and that name at least one acceptable root. */
  readonly cases: number;
  /** Cases satisfied at `w = 0` — the population the window must protect. */
  readonly satisfied: number;
  /** Cases no weight can satisfy, and that are not satisfied at 0 either. */
  readonly unreachable: number;
  /**
   * WHY those cases are unreachable — a partition of {@link unreachable}, not a second count.
   *
   * A count with no mechanism is the shape this register replaces: `48` reads the same whether
   * the term has no input in those cases, or reads a deciding pair as EQUAL, or can separate
   * every rival and still not satisfy them together. The three answers close different axes —
   * a data gap, the artifact's resolution, and the term's reach — and one of them is what the
   * paired dispatch's residual turned out to be, found by HAND because this number did not say.
   */
  readonly unreachableByCause: UnreachableCauses;
  /**
   * The satisfied cases the MODEL cannot hold a bound on, because the artifact cannot order a pair
   * the engine can — the satisfied side of the same two services {@link unreachableByCause} files
   * under `tiedAtRender`.
   */
  readonly capUnrepresentable: UnrepresentableFrontier;
  /** The largest weight at which no currently-correct case loses rank 1. */
  readonly cap: number;
  /** The case that sets `cap`, and the pair whose ratio the cap is. */
  readonly capBinder?: WindowCapBinder;
  /** Currently-wrong cases a weight can fix, with the weights that fix them. */
  readonly gains: readonly WindowGain[];
}

/**
 * The ways a case can be unreachable at every weight, in the order they are attributed.
 *
 * The order is part of the measurement: a case can fail for more than one reason, and the classes
 * are tried in the order of how far UPSTREAM the obstacle is — a root the display never describes is
 * a data gap, a case with one coefficient has nothing to weigh, a pair the term never measured is a
 * pair nothing can weigh later either, a pair the term reads as equal is decided by the base at
 * every weight, and only what remains is the term failing to reach.
 */
export interface UnreachableCauses {
  /**
   * No acceptable root of the case is in the coefficient map at all.
   *
   * The block names a ground-truth service it does not print a row for, or prints it without a
   * decisive composition, so `targetInterval` has nothing to solve. A DATA gap: it is reported
   * rather than folded into the term's reach, because the same count under the other label
   * would read as a property of the signal.
   */
  readonly rootWithoutRow: number;
  /**
   * The case holds at most ONE distinct slope, so no weight can reorder anything in it.
   *
   * The term is inert there by construction — the same condition {@link cvAvailability} counts
   * as "with a SPREAD". It is not a failure of the weight: there is no distance to weigh.
   */
  readonly noSpread: number;
  /**
   * An acceptable root sits behind an equal-slope rival, and the term weighed NEITHER of that pair.
   *
   * Two services the block never decomposed both carry a slope of `0`, and the engine's map has no
   * entry for either — so the pair is equal on both sides and no weight will ever move it. Reported
   * apart from {@link tiedAtRender} because the two have opposite fixes: this one needs a
   * MEASUREMENT, and under the other label it reads as a resolution limit of a term that was never
   * given an input.
   */
  readonly unweighed: number;
  /**
   * An acceptable root is behind a rival the term reads as EQUAL, with both sides weighed.
   *
   * `targetInterval`'s third case: equal slopes and a higher base on the rival means the base
   * decides the pair forever. For `cv` that is the artifact's three decimals — two services
   * whose cvs render equal share a slope whatever the weight, while the ENGINE ranked the
   * unrounded field, and the tie group can hide several rank positions at once. A genuine
   * engine-side tie lands in the same class and is not distinguishable from the dump, which is
   * why the class is named for what the artifact shows.
   */
  readonly tiedAtRender: number;
  /**
   * Every rival is separable and no single weight satisfies the floors and the caps at once.
   *
   * The remaining class: the term CAN act here, and the case is out of its reach — the weight
   * that would fix it against one rival costs it more against another. This is the only one of
   * the five that is a statement about the SIGNAL.
   */
  readonly outOfReach: number;
}

/**
 * The satisfied cases on the OTHER side of the same geometry: the ones that can be LOST.
 *
 * A satisfied case whose root LEADS a rival the term reads as EQUAL has, in the model, no bound from
 * that pair — equal slopes mean the score gap between them is the base gap at every weight. The
 * engine, ranking the unrounded field, splits the pair and gets a real bound out of the same two
 * services, so the model's cap is an UPPER end rather than the cap. Measured on the run this class
 * was built from: the case the engine lost at `0.030170` is one of these.
 */
export interface UnrepresentableFrontier {
  /**
   * Satisfied cases whose builder stated which services the term weighed — the denominator.
   *
   * Without it the count has no population: `3` reads the same whether the dump holds thirty
   * decidable cases or three thousand.
   */
  readonly declared: number;
  /**
   * Of those, the cases holding a rival the term reads as EQUAL behind an acceptable root.
   *
   * A pair the term weighed on NEITHER side does not count: it is equal in the engine too, so it
   * hides no ordering, and counting it would report one on the engine's own legal output.
   */
  readonly cases: number;
  /**
   * {@link cases}, by name, sorted.
   *
   * The class a reader can CHECK rather than a number they must take: it is the set of cases in which
   * the model and the engine are free to disagree, so a paired dispatch's own lost cases have to be a
   * subset of it. A count with no membership cannot be refuted, and the whole point of this field is
   * that one case the engine lost was found by hand-diffing two runs.
   */
  readonly datapacks: readonly string[];
  /**
   * Whether the case that SETS `cap` is one of them.
   *
   * The difference between "the cap value is exact, and other cases may leave earlier" and "the cap
   * itself is only the upper end of a bound the artifact cannot decide".
   */
  readonly setsCap: boolean;
  /**
   * The earliest weight at which this channel can cost a PROTECTED case — `lead / span` of the pair
   * that grants the engine the widest gap, `+Infinity` when there is no member.
   *
   * The number that turns "the cap is an upper bound" from a caveat into a measurement: compared with
   * `cap`, it says whether the looseness can bite anywhere inside the window the cap describes.
   * ABOVE the cap, every member is unthreatened for every weight the window covers; BELOW it, the
   * artifact permits the engine to lose a case the model keeps, and {@link CapFloorBinder} names the
   * pair that permits it first — so a reader can neither dismiss the class as theoretical nor read it
   * as a prediction of which case will go.
   *
   * It is the TIE channel ONLY. The base is reconstructed from the same three-decimal dump, so its
   * own resolution is a second channel with its own measurement (`gainResolution`), and this number
   * says nothing about it.
   */
  readonly lossFloor: number;
  /** The pair that sets {@link lossFloor}; absent exactly when the class is empty. */
  readonly lossFloorBinder?: CapFloorBinder;
}

/** One currently-wrong case, and the weights at which it becomes correct. */
export interface WindowGain {
  readonly datapack: string;
  readonly intervals: readonly WeightInterval[];
}

/**
 * WHY the window stops where it does.
 *
 * A cap on its own is not actionable. The cap is `lead / slopeGap` for exactly one
 * currently-correct case, and those two quantities decide what — if anything — could
 * move it:
 *
 * - a target whose slope is already `0` against a rival whose slope is already `1`
 *   is the maximal gap, so **no** pointwise reshaping of the term can raise the cap.
 *   That case's cap is a property of the rest of the score, not of the term's shape;
 * - a modest gap is where a reshaping of the term has room, and the three numbers
 *   below are what a candidate must be designed against.
 *
 * `lead` and `slopeGap` are recorded rather than recomputed so a report can print the
 * division it performed.
 */
export interface WindowCapBinder {
  readonly datapack: string;
  /** The service that must stay at rank 1. */
  readonly target: string;
  /** The service that takes rank 1 from it. */
  readonly rival: string;
  readonly targetSlope: number;
  readonly rivalSlope: number;
  /** `target.base − rival.base`, the target's lead at `w = 0` (always positive). */
  readonly lead: number;
  /** `rival.slope − target.slope`, always positive. */
  readonly slopeGap: number;
}

/** One weight, and what the case set looks like there. */
export interface WindowSample {
  readonly weight: number;
  /** Cases satisfied at this weight (including the gains below). */
  readonly correct: number;
  /** Satisfied here, unsatisfied at 0. */
  readonly gained: number;
  /** Satisfied at 0, unsatisfied here — the regressions the criterion forbids. */
  readonly lost: number;
}

/**
 * Weights every window report probes, unless a caller supplies its own.
 *
 * Includes 0.03 because that is the shipped latency weight: a window report that
 * did not sample the operating point could not be compared with the run that
 * measured it.
 */
export const DEFAULT_WINDOW_GRID: readonly number[] = [
  0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.1, 0.25, 0.5, 0.75, 1,
];

/** Whether a union of intervals covers `w`. */
function intervalsCover(intervals: readonly WeightInterval[], w: number): boolean {
  return intervals.some(
    (interval) => w >= interval.min - WEIGHT_EPSILON && w <= interval.max + WEIGHT_EPSILON,
  );
}

/**
 * The right end of the interval component containing 0.
 *
 * `+Infinity` when the component is unbounded, `-Infinity` when 0 is not covered
 * at all. The distinction matters: only a case that IS covered at 0 can cap the
 * window, because only a case that is correct today can regress.
 */
function componentEndingAtZero(intervals: readonly WeightInterval[]): number {
  let end = Number.NEGATIVE_INFINITY;
  for (const interval of intervals) {
    if (interval.min <= WEIGHT_EPSILON && interval.max >= -WEIGHT_EPSILON) {
      end = Math.max(end, interval.max);
    }
  }
  return end;
}

/**
 * Recover the pair whose ratio IS the cap, for the report.
 *
 * Recomputed from the case's scores instead of threaded out of
 * {@link componentEndingAtZero}: that helper works on the union over a case's
 * acceptable roots, where the binding root is exactly what it discards. One scan of
 * one case is cheaper than making every caller carry a root it does not need.
 *
 * @param one - The binding case.
 * @param cap - The cap it set.
 * @returns The overtaking pair, or `undefined` when none reproduces the cap: an
 *   unbounded cap, or a cap inside the epsilon band below zero, where float noise
 *   in `(−lead)/(−slopeGap)` can leave the ratio negative while the case still
 *   counts as covered at zero. The search is a search rather than a value threaded
 *   out of {@link componentEndingAtZero} because that helper works on the union
 *   over a case's acceptable roots — which is exactly where the binding root is
 *   discarded.
 */
function capBinderOf(one: WeightSeparationCase, cap: number): WindowCapBinder | undefined {
  if (!Number.isFinite(cap)) return undefined;
  for (const target of one.targets) {
    const t = one.scores.get(target);
    if (t === undefined) continue;
    for (const [rival, other] of one.scores) {
      if (rival === target) continue;
      const slopeGap = other.slope - t.slope;
      const lead = t.base - other.base;
      // `lead < 0`, not `lead <= 0`: a target LEVEL with a steeper rival is held
      // by a tie at zero and lost by any weight above it, so its cap is zero and
      // `0 / slopeGap` IS that cap. Excluding it made the only reachable
      // `undefined` return print "no case can be overtaken at any weight" about a
      // case that every weight overtakes.
      if (slopeGap <= WEIGHT_EPSILON || lead < 0) continue;
      // Relative tolerance: the cap was chosen as this very ratio, so a match is
      // exact up to the float arithmetic that produced both.
      if (Math.abs(lead / slopeGap - cap) <= Math.max(WEIGHT_EPSILON, Math.abs(cap) * 1e-9)) {
        return {
          datapack: one.datapack,
          target,
          rival,
          targetSlope: t.slope,
          rivalSlope: other.slope,
          lead,
          slopeGap,
        };
      }
    }
  }
  return undefined;
}

/**
 * Whether the case declares `service`'s slope as a MEASUREMENT.
 *
 * Absent provenance reads as WEIGHED, which is deliberately the LOOSER reading here and the stricter
 * one in {@link leadsRenderTiedRival}: this helper answers the unreachable side's question ("would
 * the term have separated the pair?"), and a builder that says nothing about provenance keeps the
 * attribution it had before the field existed. The satisfied side makes a CLAIM about a rendered
 * tie, so it requires the declaration rather than assuming one.
 *
 * @param one - The case.
 * @param service - The service to look up.
 * @returns Whether the term weighed it, or the caller declared nothing.
 */
function weighed(one: WeightSeparationCase, service: string): boolean {
  return one.weighed === undefined || one.weighed.has(service);
}

/**
 * One pair an acceptable root LEADS, where the term reads both sides as EQUAL.
 *
 * `span` is the widest gap the ENGINE can have for the pair, and it is derivable rather than assumed:
 * two services whose rendered `cv` is equal have unrounded values inside one rounding cell, so their
 * ranks are CONSECUTIVE among the cell's `g` members and their slope gap cannot exceed
 * `(g − 1)/(n − 1)`. The engine's own bound from this pair is `lead / gap ≥ lead / span`, which is what
 * makes `lead / span` the earliest weight at which the pair can cost the case — an upper end of the
 * damage, and the reason a bare count of such cases cannot be turned into a claim about the cap.
 */
export interface RenderedTiePair {
  readonly target: string;
  readonly rival: string;
  /** `target.base − rival.base`, always positive: only a pair the root LEADS is one it can lose. */
  readonly lead: number;
  /** The widest slope gap the engine can have for the pair, `(g − 1) / (n − 1)`. */
  readonly span: number;
  /** Services in the pair's rendered tie group — `g`. */
  readonly group: number;
  /** The case's weighed services — the engine's `n`, which is the divisor. */
  readonly weighed: number;
}

/** The pair that grants the engine the widest gap, and the weight that follows from it. */
export interface CapFloorBinder extends RenderedTiePair {
  readonly datapack: string;
  /** `lead / span` — the earliest weight at which this pair can cost the case. */
  readonly floor: number;
}

/**
 * The pairs an acceptable root of the case LEADS while the term reads both sides as EQUAL.
 *
 * The mirror of the unreachable side's `tiedAtRender` branch: there the equal pair is read with the
 * rival ahead, so no weight satisfies the case at all; here the root is ahead, so the model reads the
 * pair as one that can never change and imposes no bound — while the engine, ranking the UNROUNDED
 * field, splits the pair and gets a real bound out of the same two services.
 *
 * Counts the group by equal SLOPE, which is exact rather than a shortcut: every shape builds a slope
 * as one arithmetic expression over `cv`, so equal `cv` gives bit-identical coefficients while two
 * different cells differ by at least `1/(n − 1)`. A service the term never weighed is EXCLUDED, and
 * that is not a detail — it carries `0` with nothing behind it, and the engine reads `0` for it too,
 * so a pair equal only because both sides are placeholders hides no ordering.
 *
 * @param one - The case.
 * @returns The pairs, empty when the case declares no provenance or holds none.
 */
function renderedTiePairs(one: WeightSeparationCase): readonly RenderedTiePair[] {
  if (one.weighed === undefined) return [];
  const n = one.weighed.size;
  if (n < 2) return [];
  const groups = new Map<number, number>();
  for (const [service, { slope }] of one.scores) {
    if (!one.weighed.has(service)) continue;
    groups.set(slope, (groups.get(slope) ?? 0) + 1);
  }
  const pairs: RenderedTiePair[] = [];
  for (const name of one.targets) {
    const target = one.scores.get(name);
    if (target === undefined || !one.weighed.has(name)) continue;
    for (const [rival, other] of one.scores) {
      if (rival === name || !one.weighed.has(rival)) continue;
      if (other.slope !== target.slope) continue;
      if (other.base >= target.base) continue;
      const group = groups.get(target.slope)!;
      pairs.push({
        target: name,
        rival,
        lead: target.base - other.base,
        span: (group - 1) / (n - 1),
        group,
        weighed: n,
      });
    }
  }
  return pairs;
}

/**
 * Whether the case holds such a pair at all.
 *
 * A view of {@link renderedTiePairs} rather than a second scan, so the count and the floor cannot
 * come from two different notions of a tie.
 *
 * @param one - The case.
 * @returns Whether the case has at least one.
 */
function leadsRenderTiedRival(one: WeightSeparationCase): boolean {
  return renderedTiePairs(one).length > 0;
}

/**
 * Which of {@link UnreachableCauses} an unreachable case falls into.
 *
 * Read off the CONSTRAINTS the solver already built, so the classification cannot disagree with
 * the answer it explains: the slopes decide whether anything can be weighed and whether a pair is
 * ordered by the base forever, and both are the same numbers `targetInterval` intersected.
 *
 * @param one - The case, as {@link buildWeightSeparationCases} left it.
 * @returns The cause, by the precedence the type documents.
 */
function unreachableCause(one: WeightSeparationCase): keyof UnreachableCauses {
  // 1. A root the map does not describe. Checked FIRST and over every target, so a case whose
  //    only root is missing is reported as the data gap it is rather than as a term that cannot
  //    reach — the two have different fixes.
  if (one.targets.every((name) => !one.scores.has(name))) return 'rootWithoutRow';
  // 2. At most one distinct slope: nothing for the weight to separate. Compared with the same
  //    tolerance the interval solver uses, so "equal" means the same thing here and there.
  let spread = false;
  let first: number | undefined;
  for (const { slope } of one.scores.values()) {
    if (first === undefined) first = slope;
    else if (Math.abs(slope - first) > WEIGHT_EPSILON) {
      spread = true;
      break;
    }
  }
  if (!spread) return 'noSpread';
  // 3. An equal-slope rival ahead of an acceptable root, split by whether the term had a number for
  //    BOTH sides. Equal slopes mean the base decides the pair at every weight either way, but the
  //    two ways a pair arrives at an equal slope are different findings: a pair the term never
  //    weighed is equal in the ENGINE too, so its fix is a measurement, while a rendered tie is the
  //    artifact's resolution and the engine has already ordered it. `unweighed` outranks the render
  //    because it is further upstream — the same precedence the two measurements have in the dump.
  let renderTie = false;
  for (const name of one.targets) {
    const target = one.scores.get(name);
    if (target === undefined) continue;
    for (const [rival, other] of one.scores) {
      if (rival === name) continue;
      if (Math.abs(other.slope - target.slope) > WEIGHT_EPSILON) continue;
      if (other.base <= target.base) continue;
      if (weighed(one, name) && weighed(one, rival)) renderTie = true;
      else return 'unweighed';
    }
  }
  if (renderTie) return 'tiedAtRender';
  return 'outOfReach';
}

/**
 * Solve the zero-regression window for a case set.
 *
 * @param cases - Input from {@link buildWeightSeparationCases}.
 * @returns The window, with its binder and the gains inside it.
 */
export function computeZeroRegressionWindow(
  cases: readonly WeightSeparationCase[],
): ZeroRegressionWindow {
  let satisfied = 0;
  // One counter per cause plus the total they partition, so a reader can neither quote a class
  // as the whole nor read the whole as a class. The partition is asserted in the suite.
  const causes = { rootWithoutRow: 0, noSpread: 0, unweighed: 0, tiedAtRender: 0, outOfReach: 0 };
  let cap = Number.POSITIVE_INFINITY;
  let capCase: WeightSeparationCase | undefined;
  let declared = 0;
  const unrepresentable: string[] = [];
  let lossFloor = Number.POSITIVE_INFINITY;
  let lossFloorBinder: CapFloorBinder | undefined;
  const gains: WindowGain[] = [];

  for (const one of cases) {
    const allowed = caseWeightInterval(one);
    const baseline = componentEndingAtZero(allowed);
    if (baseline === Number.NEGATIVE_INFINITY) {
      // Not correct at w = 0. It cannot regress, so it never caps the window: an
      // empty interval means no weight satisfies it, which is a gain that is out of
      // reach rather than a constraint.
      if (allowed.length === 0) causes[unreachableCause(one)]++;
      else gains.push({ datapack: one.datapack, intervals: allowed });
      continue;
    }
    satisfied++;
    // The other side of the same geometry. A satisfied case that leads a rival the term reads as
    // EQUAL carries no bound from that pair, and the engine's own ordering of it is a bound the
    // artifact cannot express — so it is counted here, beside the cap it qualifies, rather than
    // left for a reader to find by diffing a run against the screen.
    if (one.weighed !== undefined) {
      declared++;
      const pairs = renderedTiePairs(one);
      if (pairs.length > 0) unrepresentable.push(one.datapack);
      // The floor, from the SAME pairs the count comes from: each grants the engine a gap of at most
      // `span`, so each can cost the case no earlier than `lead / span`, and the earliest of them is
      // what a reader compares against the cap.
      for (const pair of pairs) {
        const floor = pair.lead / pair.span;
        if (floor < lossFloor) {
          lossFloor = floor;
          lossFloorBinder = { datapack: one.datapack, ...pair, floor };
        }
      }
    }
    // With a union of intervals per case, the intersection's component at 0 ends at
    // the SMALLEST of the per-case component ends — the case that reaches the least
    // far is the one that binds.
    if (baseline < cap) {
      cap = baseline;
      capCase = one;
    }
  }

  return {
    cases: cases.length,
    satisfied,
    unreachable:
      causes.rootWithoutRow +
      causes.noSpread +
      causes.unweighed +
      causes.tiedAtRender +
      causes.outOfReach,
    unreachableByCause: causes,
    capUnrepresentable: {
      declared,
      cases: unrepresentable.length,
      datapacks: [...unrepresentable].sort(),
      // Asked of the FINAL binder rather than tracked in the loop, so the answer cannot disagree
      // with the case `capBinder` names: one predicate, one owner of "who sets the cap".
      setsCap:
        capCase !== undefined && capCase.weighed !== undefined && leadsRenderTiedRival(capCase),
      lossFloor,
      ...(lossFloorBinder === undefined ? {} : { lossFloorBinder }),
    },
    cap,
    capBinder: capCase === undefined ? undefined : capBinderOf(capCase, cap),
    gains,
  };
}

/**
 * Evaluate the case set at each weight in `grid`.
 *
 * @param cases - Input from {@link buildWeightSeparationCases}.
 * @param grid - Weights to probe, in any order; the result keeps that order.
 * @returns One sample per weight.
 */
export function zeroRegressionSamples(
  cases: readonly WeightSeparationCase[],
  grid: readonly number[],
): readonly WindowSample[] {
  const intervals = cases.map((one) => caseWeightInterval(one));
  const atZero = intervals.map((one) => intervalsCover(one, 0));
  return grid.map((weight) => {
    let correct = 0;
    let gained = 0;
    let lost = 0;
    intervals.forEach((one, index) => {
      const here = intervalsCover(one, weight);
      if (here) correct++;
      if (here && !atZero[index]) gained++;
      if (!here && atZero[index]) lost++;
    });
    return { weight, correct, gained, lost };
  });
}

/**
 * A family penalty screened against the SHIPPED score.
 *
 * `score(v) = shipped(v) + w × (−1 when v's dominant family is F, else 0)`, `w ≥ 0`. The
 * base is the engine's own four terms, taken from {@link shippedScores} so this cannot
 * become a second implementation of the score — a screen that re-derived the blend would
 * be measuring a different engine than the one it reports on.
 *
 * Everything below is SOLVED, never sampled: each case's requirement is a union of
 * half-lines in `w` (see {@link caseWeightInterval}), so the admissible window, the gain
 * inside it and the weights at which each gain arrives are all closed forms.
 */
export interface FamilyScreenWeights {
  /** The run's log weight — the scale of the log term, and never defaulted. */
  readonly logWeight: number;
  /** The run's latency weight and rise floor. Default to the shipped constants. */
  readonly latWeight?: number;
  readonly latFloor?: number;
  /**
   * The run's pool penalty. Defaults to the shipped constant, so a family is screened
   * against the engine that exists. `0` is the explicit three-term ablation — and it is
   * the configuration the pool family's own window was measured at, because at the
   * shipped weight that term has already spent part of the budget (`cap` shifts down by
   * exactly the weight already applied, which is a test).
   */
  readonly poolWeight?: number;
  /**
   * The run's temporal pair, on the same rule as the pool penalty: a family weight is
   * measured ON the shipped configuration, so the base it is a distance from carries the
   * shipped term. {@link onsetScreen} is the one caller that must NOT inherit this — the
   * term it solves cannot be in its own base — and it says so where it builds the base.
   */
  readonly temporalWeight?: number;
  readonly onsetShape?: OnsetShape;
}

/** One family's solved screen. */
export interface FamilyScreenRow {
  /** The family key, from {@link dominantFamily} — the screen's unit of grouping. */
  readonly family: string;
  /**
   * The distinct dominant labels observed in this family, sorted.
   *
   * Printed because the grouping IS a judgement: a reader has to be able to see that
   * `http.server.request.duration` and its `.max` variant were counted as one family,
   * rather than taking the row's name on trust.
   */
  readonly labels: readonly string[];
  /** Services (over every case) whose dominant metric is in the family. */
  readonly services: number;
  /** Cases with at least one such service. */
  readonly cases: number;
  /** Currently-wrong cases this penalty fixes at the best admissible weight. */
  readonly gain: number;
  /** The per-fault-type split of the gain, which is what the kill criterion asks about. */
  readonly gainTypes: readonly { readonly key: string; readonly cases: number }[];
  /** The gained cases, by datapack, so a row's gain can be audited case by case. */
  readonly gained: readonly string[];
  /** {@link gained}, with the margin each case has at {@link ship}; thinnest first. */
  readonly margins: readonly WindowGainMargin[];
  /** What this row's count survives of the digits the dump discarded. */
  readonly resolution: GainResolution;
  /** Currently-wrong cases no weight can fix — context for a zero gain. */
  readonly unreachable: number;
  /** {@link unreachable}, split by why: a zero gain means different things per class. */
  readonly unreachableByCause: UnreachableCauses;
  /** Cases correct at `w = 0`; the population the window protects. */
  readonly satisfied: number;
  /** The largest weight at which no currently-correct case loses rank 1. */
  readonly cap: number;
  /** The smallest weight at which the gain reaches its maximum. */
  readonly gainFloor: number;
  /** The largest weight at which the gain still holds its maximum. */
  readonly bestEnd: number;
  /**
   * The gain as a step function of the weight, over the admissible window.
   *
   * Reported because the maximum alone hides the shippable compromise: the metric term's
   * top step is a CONSTANT for a fixed candidate count, so the weight that wins a case and
   * the weight that loses one are frequently the same number, and a family's maximal gain
   * then sits at a single weight while a smaller one collects most of it. A profile of
   * `1 at 0.004, 4 at 0.006, 5 at 0.010` recommends something the interval alone cannot.
   * Its entries are the weights {@link gainProfile} evaluated at, so a count that FALLS is in
   * it: the profile is the one place a report can show a gain measured as absent somewhere.
   */
  readonly steps: readonly FamilyScreenStep[];
  /**
   * The weight to ship: the midpoint of the WIDEST maximal-gain range, or its single value when
   * that range has no interior. `0` when there is no gain — the term is then not applied at all,
   * and a positive number here would be a weight that buys nothing.
   */
  readonly ship: number;
  /** The pair whose ratio sets the cap; absent when the cap is unbounded. */
  readonly capBinder?: WindowCapBinder;
  /** Losses at {@link ship}, which must be `0` — measured, not inferred from the cap. */
  readonly lostAtShip: number;
  /**
   * Whether this is the family the ENGINE's own pool penalty already subtracts from.
   * Not an exclusion — a label. The row is still solved and still comparable.
   */
  readonly enginePoolFamily: boolean;
}

/** One breakpoint of a family's gain profile. */
export interface FamilyScreenStep {
  /**
   * A weight the profile was EVALUATED at — an edge of some gain's admissible set, or the midpoint
   * of the gap between two such edges.
   *
   * Both kinds are needed. An edge is a weight at which a gain can still hold (the intervals are
   * closed), while a gap's midpoint is strictly inside a stretch where no gain's coverage changes.
   * Scanning the edges alone reads two disjoint admissible intervals as ONE, because the point
   * where the first ends is an edge of the second: one case satisfied on `[0.20, 0.30] ∪ [0.35, ∞)`
   * agrees with a second satisfied on `[0.30, 0.55]` at every edge, and disagrees everywhere in
   * between.
   */
  readonly weight: number;
  /** Cases satisfied at this weight that are NOT satisfied at `w = 0`. */
  readonly gained: number;
}

/**
 * The gain profile over `[0, cap]`, as evaluated samples.
 *
 * Reported because the maximum alone hides the shippable compromise: the metric term's top step is
 * a CONSTANT for a fixed candidate count, so the weight that wins a case and the weight that loses
 * one are frequently the same number, and a family's maximal gain then sits at a single weight
 * while a smaller one collects most of it.
 *
 * A SCAN of the admissible sets, not a cumulative count over their floors. The distinction is the
 * difference between a report and an assumption: `caseWeightInterval` returns a LIST of intervals
 * precisely because a case satisfied by either of two roots can be satisfied over two disjoint
 * weight ranges, so a count that rises at a gain's floor and never falls claims the gap between
 * them — the one thing that function's own documentation says must not happen. For the FAMILY
 * slope the two agree, because a non-member root's requirement is a half-line and the union really
 * is `[floor, ∞)`; for the decisive-stability and failed-edge slopes the gap is reachable.
 *
 * @param gains - The window's currently-wrong cases.
 * @param cap - The window's cap, possibly unbounded.
 * @returns Ascending samples, from `0` to the cap.
 */
function gainProfile(gains: readonly WindowGain[], cap: number): readonly FamilyScreenStep[] {
  const edges = new Set<number>([0]);
  for (const gain of gains) {
    for (const interval of gain.intervals) {
      if (interval.min <= cap + WEIGHT_EPSILON) edges.add(interval.min);
      // A `max` of `Infinity` is not a weight, and one above the cap is outside the window.
      if (Number.isFinite(interval.max) && interval.max <= cap + WEIGHT_EPSILON)
        edges.add(interval.max);
    }
  }
  if (Number.isFinite(cap)) edges.add(cap);
  const ascending = [...edges].sort((a, b) => a - b);
  const samples: number[] = [...ascending];
  for (let index = 0; index + 1 < ascending.length; index++) {
    samples.push((ascending[index]! + ascending[index + 1]!) / 2);
  }
  return [...new Set(samples)]
    .sort((a, b) => a - b)
    .map((weight) => ({
      weight,
      gained: gains.filter((gain) => intervalsCover(gain.intervals, weight)).length,
    }));
}

/*
 * WHY a gained case is `[floor, ∞)` under a FAMILY's slope — and why that stopped being an
 * assumption about every slope.
 *
 * A family penalty subtracts `w` from each member, so a root that is not a member keeps its score
 * while the members drop:
 *
 * - a gain is a case NOT satisfied at `w = 0`, so no root's interval covers 0;
 * - a non-member root that is first at any weight stays first: its interval is `[floor, ∞)`;
 * - a member root is capped from above by every non-member ahead of it, so its interval either
 *   covers 0 (and the case is not a gain) or is empty.
 *
 * The union is therefore `[min floor, ∞)`, and the family screen's profile is monotone. That
 * argument is the FAMILY's: it turns on the slope only ever hurting members. The decisive-stability
 * and failed-edge slopes are differences of two positive scores, so a rival's slope can cap a root
 * from above — there the union is a LIST of islands and the gap between them is a weight at which
 * the case is NOT satisfied. `gainProfile` scans the intervals so both are measured.
 */

/**
 * Build the solver's input for ONE family.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's configuration.
 * @param family - The family whose members carry the slope.
 * @returns One entry per case whose targets the dump describes.
 */
function buildFamilyCases(
  cases: readonly DiagnosedCase[],
  weights: FamilyScreenWeights,
  family: string,
): WeightSeparationCase[] {
  const latWeight = weights.latWeight ?? SHIPPED_LAT_WEIGHT;
  const latFloor = weights.latFloor ?? SHIPPED_LAT_FLOOR;
  const poolWeight = weights.poolWeight ?? SHIPPED_POOL_WEIGHT;
  const built: WeightSeparationCase[] = [];
  for (const kase of cases) {
    // EVERY acceptable root, as everywhere else: the labels are a list.
    const targets = kase.groundTruth.filter((name) => name !== '');
    if (targets.length === 0) continue;
    const base = shippedScores(kase, {
      logWeight: weights.logWeight,
      latWeight,
      latFloor,
      poolWeight,
      // A family's weight is measured ON the shipped configuration, so the shipped
      // temporal pair is part of the base.
      temporalWeight: weights.temporalWeight ?? SHIPPED_TEMPORAL_WEIGHT,
      onsetShape: weights.onsetShape ?? SHIPPED_ONSET_SHAPE,
    });
    const scores = new Map<string, { base: number; slope: number }>();
    for (const service of kase.services) {
      scores.set(service.serviceId, {
        // Total by construction — `shippedScores` assigns an entry to every service —
        // so the lookup asserts rather than defaulting to a base nobody computed.
        base: base.get(service.serviceId)!,
        slope: dominantFamily(service.dominantMetric) === family ? -1 : 0,
      });
    }
    built.push({ datapack: kase.datapack, targets, scores });
  }
  return built;
}

/**
 * One weight window, solved and reduced to what a decision needs.
 *
 * Shared by the family screen, the onset screen and the decisive-stability screen so that "how a
 * window becomes a recommendation" has ONE implementation: the plateau rule, the measured
 * `gained`/`lostAtShip` pair and the margins are what the pool penalty shipped under, and a second
 * copy of them would let three axes be chosen by three different rules.
 */
interface SolvedWindow {
  readonly window: ZeroRegressionWindow;
  readonly steps: readonly FamilyScreenStep[];
  readonly gain: number;
  /** The left end of the maximal-gain range {@link ship} was taken from. */
  readonly gainFloor: number;
  /** The right end of that range. */
  readonly bestEnd: number;
  readonly ship: number;
  /** Losses at {@link ship} — measured, not inferred from the cap. */
  readonly lostAtShip: number;
  /** The datapacks gained at {@link ship}, sorted. */
  readonly gained: readonly string[];
  /** {@link gained}, with the margin each one has at {@link ship}; thinnest first. */
  readonly margins: readonly WindowGainMargin[];
  /**
   * The same case set read at a weight the CALLER named, when one was named.
   *
   * The window answers "which weight is best here". A re-opening condition asks the other question —
   * "is candidate W neutral on this benchmark" — and until this existed the answer could only come
   * from a dispatched RUN, which states it as cells moved rather than as cases gained and lost. Two
   * benchmarks can only be compared on one axis if the same instrument produces both halves.
   */
  readonly at?: NamedWeightVerdict;
}

/**
 * What a case set does at one named weight.
 *
 * Counts AND the datapacks behind them: `lost 1` decides the criterion, but which case was given up
 * is what a reader has to check, for the same reason the window's cap names its binder.
 */
export interface NamedWeightVerdict {
  readonly weight: number;
  /** Cases satisfied at this weight. */
  readonly correct: number;
  /** Satisfied here, unsatisfied at `w = 0`. */
  readonly gained: number;
  /** Satisfied at `w = 0`, unsatisfied here — the regressions the criterion forbids. */
  readonly lost: number;
  /** {@link gained}, sorted. */
  readonly gainedDatapacks: readonly string[];
  /** {@link lost}, sorted. */
  readonly lostDatapacks: readonly string[];
}

/**
 * How much room one gained case has at the shipped weight.
 *
 * The count a screen reports is a COUNT, and on its own it cannot be read to the precision the
 * decision needs. Measured on the shipped dump of run `35107871516`: the decisive-stability screen
 * reported `gain 6` at `0.030170`, the run dispatched at that weight delivered FIVE (Top@1 756 to
 * 761, 53.2% to 53.5%, zero regressed fault types), and the case it lost had a margin of
 * `1.054e-4` against `3.129e-4` for the next-thinnest. One rank position of that term is worth
 * `ship / (services - 1)` = `6.034e-4`, six times the margin the claim rested on — and the dump
 * renders every input at three decimals, so the reconstructed base is itself only good to about
 * `1e-3`. The margin does not choose the weight; it is what makes the count readable at all.
 */
export interface WindowGainMargin {
  readonly datapack: string;
  /** The acceptable root that leads at the shipped weight. */
  readonly target: string;
  /** The nearest competitor at that weight — the case's frontier. */
  readonly rival: string;
  /** `target - rival` at the shipped weight; positive for a case in {@link SolvedWindow.gained}. */
  readonly margin: number;
  /** Services in the case, so {@link quantum} can be reproduced from the report. */
  readonly services: number;
  /** One rank position of this case's own term at the shipped weight. */
  readonly quantum: number;
}

/**
 * The frontier of one gained case at `w`: the lead its best root holds over its nearest rival.
 *
 * Read off the case's own affine scores, so it is the same arithmetic the window was solved with
 * rather than a second model of it. The report names the pair, because a margin with no rival is a
 * number nobody can act on.
 *
 * @param one - The case, which {@link SolvedWindow.gained} guarantees is satisfied at `w`.
 * @param w - The shipped weight.
 * @returns The margin, the pair that sets it, and the term's own step for this case.
 */
function marginOf(one: WeightSeparationCase, w: number): WindowGainMargin {
  const scored = [...one.scores].map(([id, affine]) => ({
    id,
    score: affine.base + w * affine.slope,
  }));
  const roots = scored.filter((candidate) => one.targets.includes(candidate.id));
  // The maximum over the acceptable roots is at or above every rival's score, because the case IS
  // satisfied here — one of the roots leads. Tie-broken by service id so the pair the report names
  // is the same on every run of the same dump.
  const best = [...roots].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))[0]!;
  let margin = Number.POSITIVE_INFINITY;
  let rival = '';
  for (const candidate of scored) {
    if (one.targets.includes(candidate.id)) continue;
    const lead = best.score - candidate.score;
    if (lead < margin) {
      margin = lead;
      rival = candidate.id;
    }
  }
  const services = one.scores.size;
  return {
    datapack: one.datapack,
    target: best.id,
    rival,
    margin,
    services,
    // A gain ranks over at least two services by construction: a one-service case satisfies its own
    // root at every weight, so it is never a gain and never reaches this function. The division is
    // therefore by a positive number, and the alternative — a branch for a case that cannot arrive —
    // would be a tolerance for a state the type already excludes.
    quantum: w / (services - 1),
  };
}

/**
 * The widest run of consecutive profile samples that attains the peak gain.
 *
 * The RUN's span is what a recommendation is trusted on. The profile evaluates at every interval
 * edge and at every gap's midpoint, so a step down at an edge is visible and a run is a genuine
 * maximal-gain range rather than the span of a set: the previous rule took the midpoint of the
 * outermost two samples, which for a case with two islands lands in the gap between them — a weight
 * that case's own interval arithmetic says does NOT satisfy it.
 *
 * A tie goes to the earlier run, and the weights are distinct, so two runs of the report compare.
 *
 * @param steps - The evaluated profile, ascending.
 * @param gain - The peak gain to run over.
 * @returns The span of the widest run attaining `gain`.
 */
function widestPlateau(
  steps: readonly FamilyScreenStep[],
  gain: number,
): { readonly from: number; readonly to: number } {
  let best = { from: 0, to: 0, width: -1 };
  let start = -1;
  for (let index = 0; index <= steps.length; index++) {
    const at = index < steps.length && steps[index]!.gained === gain;
    if (at && start < 0) start = index;
    if (!at && start >= 0) {
      const from = steps[start]!.weight;
      const to = steps[index - 1]!.weight;
      if (to - from > best.width) best = { from, to, width: to - from };
      start = -1;
    }
  }
  return { from: best.from, to: best.to };
}

/**
 * Solve one candidate set's window and reduce it to a recommendation.
 *
 * Exported because it is the rule every screen is decided by: a caller can hand it a case set and
 * check that the weight it recommends satisfies the gains it claims, which is the invariant the
 * three screens' reports inherit and cannot assert on their own.
 *
 * @param built - Input from {@link buildWeightSeparationCases} or a screen's own builder.
 * @returns The window, its profile, and the weight to ship with its margins.
 */
export function solveZeroRegressionWindow(
  built: readonly WeightSeparationCase[],
  at?: number,
): SolvedWindow {
  const window = computeZeroRegressionWindow(built);
  const steps = gainProfile(window.gains, window.cap);
  const gain = steps.reduce((best, step) => (step.gained > best ? step.gained : best), 0);
  const plateau = widestPlateau(steps, gain);
  // The weight to ship is the midpoint of the widest maximal-gain range, or its single value when
  // the range has no interior — the same midpoint rule the pool penalty shipped its own weight
  // under. `0` when there is no gain at all: a positive weight that buys nothing is a configuration
  // change with no measured effect.
  const ship = gain === 0 ? 0 : (plateau.from + plateau.to) / 2;
  const byPack = new Map(built.map((one) => [one.datapack, one]));
  // Measured AT the weight that is recommended, which is the same weight `lostAtShip` is measured
  // at: the two halves of the claim come from one evaluation, so a report cannot name a gain its
  // own arithmetic denies at the weight it advises.
  const gained =
    gain === 0
      ? []
      : window.gains
          .filter((one) => intervalsCover(one.intervals, ship))
          .map((one) => one.datapack)
          .sort();
  const margins = gained
    .map((datapack) => marginOf(byPack.get(datapack)!, ship))
    .sort((a, b) => a.margin - b.margin || (a.datapack < b.datapack ? -1 : 1));
  return {
    window,
    steps,
    gain,
    gainFloor: plateau.from,
    bestEnd: plateau.to,
    ship,
    lostAtShip: zeroRegressionSamples(built, [ship])[0]!.lost,
    gained,
    margins,
    ...(at === undefined ? {} : { at: namedWeightVerdict(built, at) }),
  };
}

/**
 * Render a named-weight verdict, or nothing when no weight was named.
 *
 * Shared by the two screens that solve a window, so a reader comparing the decisive-stability
 * screen's verdict on one benchmark with the temporal screen's on another is reading the same
 * sentence. Placed after the population line in both, so the two MENUS — which render a shape's
 * detail by dropping that fixed prefix — carry it without a second printing.
 *
 * @param at - The verdict, when a weight was named.
 * @returns Zero or three lines, the first indented by two spaces.
 */
function namedWeightLines(at: NamedWeightVerdict | undefined): readonly string[] {
  if (at === undefined) return [];
  const lines = [
    `  at ${at.weight.toFixed(6)}: correct ${at.correct}, gained ${at.gained}, lost ${at.lost}`,
  ];
  // Both lists when both are non-empty: a weight that buys some cases and costs others is the case
  // the criterion exists for, and naming only one side is how a veto reads as a trade.
  if (at.lost > 0) lines.push(`    lost: ${at.lostDatapacks.join(', ')}`);
  if (at.gained > 0) lines.push(`    gained: ${at.gainedDatapacks.join(', ')}`);
  return lines;
}

/**
 * Read a case set at one weight, per case.
 *
 * Deliberately computed from the SAME `built` array the window was solved from — not from the
 * window — because the two answer different questions: `correct` here counts what the case set
 * satisfies at the named weight, which a window's `satisfied`/`cap` pair cannot reproduce (the cap
 * is where the FIRST case leaves; cases may have left and returned since).
 *
 * @param built - Input from {@link buildWeightSeparationCases} or a screen's own builder.
 * @param at - The weight to read.
 * @returns The counts and the datapacks behind them, both sorted.
 */
function namedWeightVerdict(
  built: readonly WeightSeparationCase[],
  at: number,
): NamedWeightVerdict {
  const gainedDatapacks: string[] = [];
  const lostDatapacks: string[] = [];
  let correct = 0;
  for (const one of built) {
    const intervals = caseWeightInterval(one);
    const here = intervalsCover(intervals, at);
    const atZero = intervalsCover(intervals, 0);
    if (here) correct++;
    if (here && !atZero) gainedDatapacks.push(one.datapack);
    if (!here && atZero) lostDatapacks.push(one.datapack);
  }
  return {
    weight: at,
    correct,
    gained: gainedDatapacks.length,
    lost: lostDatapacks.length,
    gainedDatapacks: gainedDatapacks.sort(),
    lostDatapacks: lostDatapacks.sort(),
  };
}

/**
 * Whether a case carries enough onset evidence for the temporal term to act at all.
 *
 * The engine's own rule, and the cheapest possible screen: `onsetEarliness`
 * returns an empty map unless the injection time is known AND at least two services
 * have a defined delay — one onset cannot establish a before/after order. Counting
 * that population first is the difference between "the term has no window" and "the
 * term was never switched on", which a bare gain of 0 would conflate.
 */
export interface OnsetAvailability {
  /** Cases the dump describes and that name at least one acceptable root. */
  readonly cases: number;
  /** Cases whose block carries an injection time the engine could anchor to. */
  readonly withAnchor: number;
  /** Cases with at least one service carrying a numeric onset delay. */
  readonly withOnsets: number;
  /** Cases where the earliness map is non-empty — the term can change the order. */
  readonly withEarliness: number;
  /** Services carrying a numeric onset delay, over every case. */
  readonly servicesWithOnset: number;
  /** Services in total, over every case. */
  readonly servicesTotal: number;
}

/**
 * Count how much onset evidence a dump carries.
 *
 * @param cases - Parsed cases.
 * @returns The counts.
 */
export function onsetAvailability(cases: readonly DiagnosedCase[]): OnsetAvailability {
  let cases0 = 0;
  let withAnchor = 0;
  let withOnsets = 0;
  let withEarliness = 0;
  let servicesWithOnset = 0;
  let servicesTotal = 0;
  for (const kase of cases) {
    if (!kase.groundTruth.some((name) => name !== '')) continue;
    cases0++;
    servicesTotal += kase.services.length;
    if ((kase.injectTimeMs ?? 0) > 0) withAnchor++;
    let defined = 0;
    for (const service of kase.services) {
      if (service.onsetDelayMs === undefined) continue;
      defined++;
      servicesWithOnset++;
    }
    if (defined > 0) withOnsets++;
    // Two is the engine's threshold, and it is the engine's: the call below is the
    // SAME function the ranking uses, not a re-derivation of its condition. The test
    // is on the EARLINESS map, which the engine leaves EMPTY when the term is inert —
    // testing the slope map instead would be true for every case, because that one is
    // deliberately total over the services.
    if (onsetEarliness(kase).size > 0) withEarliness++;
  }
  return {
    cases: cases0,
    withAnchor,
    withOnsets,
    withEarliness,
    servicesWithOnset,
    servicesTotal,
  };
}

/** WHICH absence stops the temporal screen — named, because they close different things. */
export type OnsetInertCause = 'no-cases' | 'no-anchor' | 'no-onset' | 'no-order';

/**
 * Why the temporal term cannot act on this artifact.
 *
 * The menu printed ONE sentence for all of these, and it asserted a fact about the ENGINE — *"the engine
 * leaves every service neutral"* — for causes that are facts about the DATA or about the CONFIGURATION.
 * `no-order` is reachable with hundreds of services carrying an onset (measured: 120 of 2900 on a golden
 * dump), where the anchor was given and the delays ARE recorded and what is missing is an ORDER. Recording
 * that as "every service neutral" points the reader at the engine when the finding is about the spread.
 *
 * @param a - The counts the availability pass produced.
 * @returns The first absence that stops the term, in the order they nest.
 */
export function onsetInertCause(a: OnsetAvailability): OnsetInertCause {
  if (a.cases === 0) return 'no-cases';
  if (a.withAnchor === 0) return 'no-anchor';
  if (a.withOnsets === 0) return 'no-onset';
  return 'no-order';
}

/**
 * The sentence a temporal menu prints INSTEAD of a window, with the label its cause earns.
 *
 * `INERT` when the term cannot reorder what the artifact RECORDS — a result about the axis — and
 * `UNEVALUABLE` when the artifact does not carry the input at all, which invites a different ARTIFACT
 * rather than a conclusion about the engine. Two pieces of work, so two words.
 *
 * @param a - The counts the availability pass produced.
 * @returns One or more indented lines.
 */
export function onsetInertSentence(a: OnsetAvailability): string[] {
  switch (onsetInertCause(a)) {
    case 'no-cases':
      return [
        '  the term is UNEVALUABLE on this dump: it names no case with an acceptable root, so there is',
        '  nothing to screen — a gap in the ARTIFACT rather than a result about the data.',
      ];
    case 'no-anchor':
      return [
        '  the term is INERT on this dump: no case carries an injection anchor, so the engine was given',
        '  no time to order — an artefact of the CONFIGURATION, not a finding about the engine.',
      ];
    case 'no-onset':
      return [
        `  the term is INERT on this dump: all ${a.withAnchor} anchored cases hold no service carrying an`,
        '  onset delay, so there is no time to order — a window here is an artefact.',
      ];
    default:
      return [
        `  the term is INERT on this dump: onsets ARE recorded (${a.servicesWithOnset} of`,
        `  ${a.servicesTotal} services) and the engine's own earliness map is empty for every case, so no`,
        '  weight can reorder anything — a window here is an artefact.',
      ];
  }
}

/** The solved onset screen. */
export interface OnsetScreen {
  /** How much of the dump carries onset evidence at all. */
  readonly availability: OnsetAvailability;
  /** Which shape of the term this window is for. */
  readonly shape: OnsetShape;
  /** The solved window over the whole dump. */
  readonly solved: SolvedWindow;
  /** The per-fault-type split of the gain — the kill criterion's second half. */
  readonly gainTypes: readonly { readonly key: string; readonly cases: number }[];
  /** What the count survives of the digits the dump discarded. */
  readonly resolution: GainResolution;
  /**
   * Where the window's own cap lands under the digits the dump discarded.
   *
   * The same second channel the stability screen reports, through the same function and the same box
   * — and it matters MORE here, because this term's column is the millisecond-rounded onset: a
   * sub-millisecond draw can break the tie that `earliest-only` credits together, so the cap is a
   * function of the print in a way the base fields alone are not.
   */
  readonly capNoise: CapResolution;
  /**
   * How much finer the render would have to be before this shape's refusal clears.
   *
   * The verdict says every refusal is a resolution bar; this says whether the RENDER is the obstacle,
   * which is a different question with a different fix. See {@link refinementFrontier}.
   */
  readonly frontier: RefinementFrontier<OnsetShape>;
}

/**
 * The ways a window can fail to be shippable, in the order the report lists them.
 *
 * Every one is a MEASURED bar rather than a style rule, and only the first is a statement about the
 * SIGNAL — the rest are the artifact's own resolution, which is what makes them worth separating.
 */
export type RefusalReason =
  /** A case is lost at the weight the caller NAMED — the direct answer to `--at-weight`. */
  | 'lost at ship'
  /** No weight makes any of this dump's misses correct: there is nothing to ship. */
  | 'no gain'
  /** The gain count holds for the printed digits but not for the box they stand for. */
  | 'gain not resolved'
  /** The window's right-hand end moves under the same draw, so its protection is not the artifact's. */
  | 'cap not resolved';

/** One shape's verdict, with every bar it rests on stated. */
export interface Admissibility<S extends string> {
  readonly shape: S;
  /** True only when {@link reasons} is empty. */
  readonly admissible: boolean;
  /**
   * EVERY bar that failed, not just the first.
   *
   * Two failures have two different fixes — a shape with no gain is a statement about the term while an
   * unresolved count is a statement about the artifact — so a verdict naming one would send a reader to
   * the wrong change. Empty when the window is shippable.
   */
  readonly reasons: readonly RefusalReason[];
  /** The sentence a report prints: the measured numbers when admissible, the failures otherwise. */
  readonly clause: string;
}

/**
 * What a verdict needs from a solved screen — the four fields BOTH menus already compute.
 *
 * A structural type rather than a union over the two screens, so the rule has ONE implementation: the
 * decisive-stability menu and the temporal menu were carrying the same `gain > 0 && lostAtShip === 0`
 * verbatim, which is a test of the window on ONE digit-set and blind to both resampling ensembles. A
 * shape whose gain holds in 56 of 100 draws was therefore listed as admissible by a line sitting under a
 * report that said exactly that, on BOTH axes.
 */
export interface ShippableWindow<S extends string> {
  readonly shape: S;
  readonly solved: SolvedWindow;
  readonly resolution: GainResolution;
  readonly capNoise: CapResolution;
}

/**
 * A solved shape's verdict, computed from the same fields its report prints.
 *
 * `--at-weight` is read first and separately: the caller has asked about a NAMED weight rather than about
 * the window, so a loss there is the answer, while the resolution figures describe another question.
 *
 * @param screen - The solved screen.
 * @returns The verdict, with every failing bar named.
 */
export function admissibilityOf<S extends string>(screen: ShippableWindow<S>): Admissibility<S> {
  const s = screen.solved;
  const gains = screen.resolution.held.length;
  const resolved = screen.resolution.resolved.length;
  const reasons: RefusalReason[] = [];
  const clauses: string[] = [];
  // The NAMED weight's own verdict, not `lostAtShip`: that one is measured at the SOLVED ship, which
  // `--at-weight` does not move — the flag answers "what happens at the weight I name" BESIDE the
  // window's own reading, so a loss there has to be read from `at.lost` or the branch never fires.
  if (s.at !== undefined && s.at.lost > 0) {
    reasons.push('lost at ship');
    clauses.push(
      `a case is lost at the named weight ${s.at.weight.toFixed(6)} (${s.at.lost} lost)`,
    );
  }
  if (s.gain === 0) {
    reasons.push('no gain');
    clauses.push('no weight fixes a case');
  } else {
    if (resolved < gains) {
      reasons.push('gain not resolved');
      clauses.push(
        `the gain holds for the printed digits only (${resolved} of ${gains} hold in every draw)`,
      );
    }
    if (screen.capNoise.lostAtShip > 0) {
      reasons.push('cap not resolved');
      clauses.push(
        `the window is lost in ${screen.capNoise.lostAtShip} of ${screen.capNoise.trials} draws of ` +
          `the discarded digits, losing at most ${screen.capNoise.worstLost}`,
      );
    }
  }
  if (reasons.length === 0) {
    return {
      shape: screen.shape,
      admissible: true,
      reasons,
      clause:
        `every one of the ${gains} gains holds in all ${screen.resolution.trials} draws, ` +
        `cap intact in ${screen.capNoise.trials - screen.capNoise.lostAtShip} of ` +
        `${screen.capNoise.trials}`,
    };
  }
  return { shape: screen.shape, admissible: false, reasons, clause: clauses.join(' and ') };
}

/**
 * Render every shape's verdict, or an empty array when no shape is admissible.
 *
 * A menu prints a block when a candidate exists and one sentence when none does, and this function decides
 * which — so the block and the sentence cannot disagree about whether one exists. It used to be reachable
 * one way only: the sentence was all there was, and a menu WITH candidates said nothing about them.
 *
 * @param screens - The solved screens, one per shape.
 * @returns One line per shape, or an empty array.
 */
export function admissibilityLines<S extends string>(
  screens: readonly ShippableWindow<S>[],
): readonly string[] {
  const verdicts = screens.map((screen) => admissibilityOf(screen));
  if (verdicts.every((one) => !one.admissible)) return [];
  const lines: string[] = ['  admissibility, on the error bars above:'];
  for (const one of verdicts) {
    lines.push(
      `    ${one.shape.padEnd(14)}${one.admissible ? 'ADMISSIBLE' : 'refused'}: ${one.clause}`,
    );
  }
  return lines;
}

/**
 * How many more digits {@link refinementFrontier} sweeps to before it reports "none".
 *
 * Six, so the sweep reaches `10^-9` on a service field and `10^-6` ms on an onset: far enough that a
 * shape which is still refused there is decided by something the render's OWN structure creates (a
 * rendered tie, or a margin inside the digits) rather than by a resolution any practical dump could
 * buy. A bound rather than a search: past it the answer stops being about the artifact.
 */
export const RESOLUTION_FRONTIER_MAX_DIGITS = 6;

/** What {@link refinementFrontier} needs. */
export interface FrontierInput<S extends string> {
  /** The gain ensemble's own arguments — the dump, the weight, and which screen asked. */
  readonly gain: GainResolutionInput;
  /** The window's solved answer, which the sweep holds FIXED: only the box moves. */
  readonly solved: SolvedWindow;
  readonly shape: S;
  /**
   * The ensembles AT the artifact's own box, which the caller already has.
   *
   * Passed in rather than re-derived, for two reasons that both matter: `k = 0` must be the SAME answer
   * the report prints (a second draw of the same box is the same draw only because the seed is fixed,
   * and an instrument should not depend on that for its agreement with itself), and it is free.
   */
  readonly atArtifact: {
    readonly resolution: GainResolution;
    readonly capNoise: CapResolution;
  };
  readonly max?: number;
}

/** One refinement's reading, so a `beyond` answer can show it is a plateau rather than a bound. */
export interface FrontierStep {
  /** The refinement this step drew at; `0` is the artifact's own box. */
  readonly extraDigits: number;
  /** Gains that held in EVERY draw at this refinement. */
  readonly resolved: number;
  /**
   * The WEAKEST gain's survival rate — the least-surviving gain's fraction of draws.
   *
   * The number that distinguishes the two reasons a sweep can end in `beyond`. If it CLIMBS as the box
   * tightens, the shortfall is proportional to the discarded digits and the bound was simply too small.
   * If it does not move, the shortfall is scale-free — which is what a rendered TIE produces, because
   * two equal prints are re-ordered by any nonzero draw however small, so no refinement of the draw can
   * settle their order. `resolved` alone cannot tell those apart: it is an integer that clips at the
   * same value on both paths.
   *
   * `undefined` when the window names no gain at all, which is the `structural` case: there is no
   * survival rate to report, and `Math.min` of nothing is `Infinity` — a number that would print as a
   * percentage and mean the opposite of the truth.
   */
  readonly weakest: number | undefined;
  /** Draws in which the window lost a protected case at this refinement. */
  readonly lostAtShip: number;
}

/**
 * The refinement a window needs before its refusal clears — the scale the render binds it at.
 *
 * Four answers, and they call for four different pieces of work, which is why they are four cases rather
 * than a nullable number:
 *
 * - `already` — the render decides the window; the refusal is nothing to do with precision.
 * - `needs` — the artifact's OWN precision is the obstacle, and `digits` is how much finer it must be.
 * - `beyond` — swept to `max` with the weakest gain's survival UNMOVED, so the shortfall is scale-free:
 *   the residue is the TIES the render created, which a finer render CHANGES rather than refines.
 * - `structural` — the refusal is not a resolution bar at all (the printed digits carry no gain), so the
 *   sweep was not run. Distinguishing this from `beyond` is the point: `beyond` is a claim about the
 *   render and this is a refusal to make one.
 */
export type RefinementFrontier<S extends string> = (
  | { readonly kind: 'already' }
  | {
      readonly kind: 'needs';
      /** The fewest extra digits at which the window becomes admissible. */
      readonly digits: number;
    }
  | { readonly kind: 'beyond' }
  | { readonly kind: 'structural' }
) & {
  /** The bound the sweep searched to. */
  readonly max: number;
  /** The verdict the answer rests on: at the artifact for `already`/`structural`, at the bound otherwise. */
  readonly verdict: Admissibility<S>;
  /** One entry per refinement swept, in order, `k = 0` first. */
  readonly trajectory: readonly FrontierStep[];
};

/**
 * Sweep the render's precision and report the scale at which a shape's refusal clears.
 *
 * Every refusal the verdict reports is a resolution bar BY CONSTRUCTION rather than by measurement:
 * `gain not resolved` is only reached once the printed digits already carry a gain, and
 * `cap not resolved` only once the solved cap is already intact — so both name a conclusion that holds
 * for the print and not for the box it stands for. What that does NOT say is whether the render is the
 * OBSTACLE. A window whose deciding gaps sit at `1e-4` is settled by one more digit; one decided by a
 * rendered tie, or by a margin an order of magnitude inside the discarded digits, is settled by no
 * practical render at all — and the two call for opposite work. So "the artifact's decimals bind this
 * axis" is a claim about SCALE, and it is measured here by moving the scale and nothing else.
 *
 * The sweep holds one thing fixed and varies one: the same dump, the same seed and trial counts, the
 * same solved window, and a box scaled by `10^-k` in EVERY field — each field from its own render, so a
 * millisecond onset stays a millisecond onset.
 *
 * What the sweep CANNOT do is model the finer dump itself, and the distinction is the reason
 * {@link FrontierStep.weakest} is recorded. A finer render is not a better-known version of these
 * numbers; its discarded digits are different numbers. So `needs` is the case where the truth sitting
 * near the print would settle the window, and `beyond` is the case where tightening changes nothing —
 * which is a statement about the ties THIS render made, not a prediction about the next one.
 *
 * A shape the printed digits give NO gain for is not swept: its refusal is a statement about the term,
 * not about the render, and spending six grids on it would produce a sentence about precision where the
 * honest answer is that precision has nothing to do with it.
 *
 * @param input - The sweep's inputs; see {@link FrontierInput}.
 * @returns Which of the four answers the window's refusal is, with the evidence it rests on.
 */
export function refinementFrontier<S extends string>(
  input: FrontierInput<S>,
): RefinementFrontier<S> {
  const max = input.max ?? RESOLUTION_FRONTIER_MAX_DIGITS;
  const step = (extraDigits: number, resolution: GainResolution, lost: number): FrontierStep => ({
    extraDigits,
    resolved: resolution.resolved.length,
    // `undefined` rather than `Math.min()` of an empty list, which is `Infinity`: a window that names no
    // gain has no survival rate, and the guard keeps that fact from being spelled as a number.
    weakest:
      resolution.held.length === 0 ? undefined : Math.min(...resolution.held) / resolution.trials,
    lostAtShip: lost,
  });
  const verdictAt = (resolution: GainResolution, capNoise: CapResolution): Admissibility<S> =>
    admissibilityOf({ shape: input.shape, solved: input.solved, resolution, capNoise });
  const atArtifact = verdictAt(input.atArtifact.resolution, input.atArtifact.capNoise);
  const opened = step(0, input.atArtifact.resolution, input.atArtifact.capNoise.lostAtShip);
  const trajectory: FrontierStep[] = [opened];
  if (atArtifact.admissible) return { kind: 'already', max, verdict: atArtifact, trajectory };
  if (input.solved.gain === 0) return { kind: 'structural', max, verdict: atArtifact, trajectory };
  let verdict = atArtifact;
  for (let extraDigits = 1; extraDigits <= max; extraDigits++) {
    const resolution = gainResolution({ ...input.gain, extraDigits });
    const capNoise = capResolution({ ...input.gain, extraDigits });
    trajectory.push(step(extraDigits, resolution, capNoise.lostAtShip));
    verdict = verdictAt(resolution, capNoise);
    if (verdict.admissible) return { kind: 'needs', digits: extraDigits, max, verdict, trajectory };
  }
  return { kind: 'beyond', max, verdict, trajectory };
}

/**
 * Render a refinement frontier as the clause a report prints beside the window.
 *
 * The four answers read as four different pieces of work, which is the whole reason the sweep exists:
 * `already` means the report already said what decides the window; `needs` means the artifact's own
 * precision is the obstacle and a finer dump is the fix, with the number saying how much finer; and
 * `beyond` means tightening changed nothing, which is printed WITH the two survival rates that say so —
 * the claim that a render is not the obstacle is exactly the kind that must arrive with its evidence.
 *
 * @param frontier - The sweep's answer.
 * @returns One line, prefixed like the other error-bar lines.
 */
export function formatRefinementFrontierLine(frontier: RefinementFrontier<string>): string {
  const first = frontier.trajectory[0]!;
  const last = frontier.trajectory[frontier.trajectory.length - 1]!;
  // Rendered through a helper so a window with no gains prints "no gains" rather than a number: the
  // field is `undefined` exactly there, and an unguarded interpolation would read `undefined%`.
  const survival = (rate: number | undefined): string =>
    rate === undefined ? 'no gains' : `${(rate * 100).toFixed(1)}%`;
  const clause =
    frontier.kind === 'already'
      ? 'the render already decides this window'
      : frontier.kind === 'needs'
        ? `the window turns on gaps the render discards, so a FINER dump settles it: ` +
          `${frontier.digits} more digit(s) — a quantum 10^${frontier.digits} smaller — admits it ` +
          `(${frontier.verdict.clause})`
        : frontier.kind === 'beyond'
          ? `no refinement up to ${frontier.max} more digit(s) admits it: at a quantum 10^` +
            `${frontier.max} smaller the weakest gain survives ${survival(last.weakest)} of draws ` +
            `against ${survival(first.weakest)} at the artifact's own box, and what is still failing ` +
            `there is ${frontier.verdict.clause} — an UNMOVED survival means the draw is re-ordering ` +
            `two equal prints, which no refinement settles, while a survival that ROSE puts the ` +
            `residue in the other channel`
          : `not a resolution question: ${frontier.verdict.clause}`;
  return `  refinement: ${clause}`;
}

/**
 * One case as the onset screen scores it: the base MINUS this term, plus the term's own slope.
 *
 * The term being solved is not in its own base: `temporalWeight: 0` here is the ablation this
 * window is a distance from, and leaving the shipped weight in would measure an ADDITIONAL onset
 * term on top of one already applied. The shape is the one under test, which is why it is the only
 * field that comes from the caller.
 *
 * A function for the same reason as {@link stabilityCase}: {@link gainResolution} resamples a
 * perturbed case through this exact arithmetic.
 *
 * @param kase - One parsed case.
 * @param weights - The configuration to screen against.
 * @param shape - Which shape of the term to solve for.
 * @returns The case's affine scores, or `undefined` when it has no ground truth to satisfy.
 */
function onsetCase(
  kase: DiagnosedCase,
  weights: FamilyScreenWeights,
  shape: OnsetShape,
): WeightSeparationCase | undefined {
  const targets = kase.groundTruth.filter((name) => name !== '');
  if (targets.length === 0) return undefined;
  const base = shippedScores(kase, {
    logWeight: weights.logWeight,
    latWeight: weights.latWeight ?? SHIPPED_LAT_WEIGHT,
    latFloor: weights.latFloor ?? SHIPPED_LAT_FLOOR,
    poolWeight: weights.poolWeight ?? SHIPPED_POOL_WEIGHT,
    temporalWeight: 0,
    onsetShape: shape,
  });
  const slopes = onsetSlopes(kase, shape);
  const scores = new Map<string, { base: number; slope: number }>();
  for (const service of kase.services) {
    scores.set(service.serviceId, {
      base: base.get(service.serviceId)!,
      slope: slopes.get(service.serviceId)!,
    });
  }
  return { datapack: kase.datapack, targets, scores };
}

/**
 * Screen the injection-anchored temporal prior for a zero-regression window.
 *
 * The axis the register's closing paragraph points at: the only per-service quantity
 * in a dump that is a TIME rather than a magnitude, and the engine's own theory
 * (collision at `t₀`, propagation `τ`). It is measured here OFFLINE, on a dump, with
 * the same solver and the same shipping rule as the family screen — a window is a
 * window, and the question "does any weight help without losing a case" does not
 * change because the slope came from a clock.
 *
 * @param cases - Parsed cases.
 * @param weights - The configuration to screen against.
 * @returns The availability counts and the solved window.
 */
export function onsetScreen(
  cases: readonly DiagnosedCase[],
  weights: FamilyScreenWeights,
  shape: OnsetShape = 'earliness',
  at?: number,
): OnsetScreen {
  const built: WeightSeparationCase[] = [];
  for (const kase of cases) {
    const one = onsetCase(kase, weights, shape);
    if (one !== undefined) built.push(one);
  }
  const solved = solveZeroRegressionWindow(built, at);
  const faultTypeOf = new Map(cases.map((kase) => [kase.datapack, kase.faultType]));
  const gainTypes = new Map<string, number>();
  for (const datapack of solved.gained) bump(gainTypes, faultTypeOf.get(datapack) ?? '');
  // Built ONCE and shared with the frontier, so the sweep's `k = 0` is literally the same ensembles the
  // report prints rather than a second draw of the same box that agrees only because the seed is fixed.
  const screen: GainResolutionScreen = { kind: 'onset', weights, shape };
  const gain: GainResolutionInput = { cases, gained: solved.gained, ship: solved.ship, screen };
  const resolution = gainResolution(gain);
  const capNoise = capResolution({ cases, ship: solved.ship, screen });
  return {
    availability: onsetAvailability(cases),
    shape,
    solved,
    capNoise,
    gainTypes: tallyCounter(gainTypes),
    resolution,
    frontier: refinementFrontier({ gain, solved, shape, atArtifact: { resolution, capNoise } }),
  };
}

/**
 * Screen every shape in {@link ONSET_SHAPES}, in declared order.
 *
 * The whole menu rather than the shape someone proposed, for the reason the family
 * screen scans every family: "no weight on THIS shape works" leaves the axis open on a
 * technicality, and the next session would find another shape to propose. A menu cannot
 * be asked to have missed a row — only to have missed a shape nobody declared.
 *
 * @param cases - Parsed cases.
 * @param weights - The configuration to screen against.
 * @returns One solved screen per shape.
 */
export function onsetShapeMenu(
  cases: readonly DiagnosedCase[],
  weights: FamilyScreenWeights,
  at?: number,
): readonly OnsetScreen[] {
  return ONSET_SHAPES.map((shape) => onsetScreen(cases, weights, shape, at));
}

/**
 * Render the whole shape menu.
 *
 * Availability comes first and once, because it is a property of the DUMP rather than
 * of a shape: if the term is inert, every row below would read `gain 0` for a reason
 * that has nothing to do with any of them.
 *
 * @param screens - The solved screens, one per shape.
 * @param weights - The configuration they were solved at, for the header.
 * @returns A multi-line report, without a trailing newline.
 */
export function formatOnsetMenuReport(
  screens: readonly OnsetScreen[],
  weights: FamilyScreenWeights,
): string {
  const first = screens[0];
  if (first === undefined) return 'Temporal (onset) screen: no shape was screened';
  const a = first.availability;
  const lines: string[] = [];
  lines.push(`Temporal (onset) screen (${configurationLine(weights)}):`);
  const share =
    a.servicesTotal === 0
      ? 'n/a'
      : `${((100 * a.servicesWithOnset) / a.servicesTotal).toFixed(1)}%`;
  lines.push(
    `  evidence: ${a.cases} cases; with an injection anchor ${a.withAnchor}; ` +
      `with an onset ${a.withOnsets}; with an ORDER the term can act on ${a.withEarliness}`,
  );
  lines.push(`  services carrying an onset: ${a.servicesWithOnset}/${a.servicesTotal} (${share})`);
  if (a.withEarliness === 0) {
    lines.push(...onsetInertSentence(a));
    // BEFORE the return, because this is the menu's other early exit: a named weight has a verdict
    // on an inert dump too — "the term changes nothing" is a measurement — and an inert dump is
    // exactly where "the weight is harmless" is the tempting conclusion the flag exists to check.
    for (const screen of screens) lines.push(...namedWeightLines(screen.solved.at));
    return lines.join('\n');
  }
  lines.push('  shape          gain  window                     width     ship      binder');
  for (const screen of screens) {
    const s = screen.solved;
    const at = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : 'unbounded');
    const width = Number.isFinite(s.window.cap)
      ? s.window.cap - s.gainFloor
      : Number.POSITIVE_INFINITY;
    lines.push(
      `  ${screen.shape.padEnd(14)}${String(s.gain).padStart(3)}  ` +
        `[${at(s.gainFloor)}, ${at(s.window.cap)}]`.padEnd(25) +
        `${(Number.isFinite(width) ? width.toFixed(6) : 'unbounded').padStart(10)}  ` +
        `${s.ship.toFixed(6).padStart(9)}  ` +
        `${s.window.capBinder === undefined ? '-' : s.window.capBinder.datapack}`,
    );
  }
  // The detail is printed for any shape with a gain, and the binder for every FINITE
  // cap: a row of zeros with no mechanism is a verdict nobody can act on or refute.
  for (const screen of screens) {
    const s = screen.solved;
    // `|| s.at !== undefined` because a NAMED weight has a verdict whether or not the window found
    // a gain — and a shape with no gain is exactly where a reader would otherwise conclude that the
    // weight is harmless. Printing the detail only `if (s.gain > 0)` rendered the flag nowhere.
    if (s.gain > 0 || s.at !== undefined) {
      lines.push('');
      lines.push(...formatOnsetScreenReport(screen, weights).split('\n').slice(3));
    } else if (s.window.capBinder !== undefined) {
      const b = s.window.capBinder;
      lines.push(
        `  ${screen.shape}: no admissible gain; cap ${s.window.cap.toFixed(6)} = ` +
          `${b.lead.toFixed(6)} / ${b.slopeGap.toFixed(6)}, bound by ${b.datapack} ` +
          `(${b.target} overtaken by ${b.rival})`,
      );
    }
  }
  // One owner of the verdict. The rule used to live HERE as `gain > 0 && lostAtShip === 0` — a test of
  // the window on one digit-set, blind to both ensembles — and it was reachable one way only: a menu
  // WITH candidates said nothing about them, because the sentence was all there was.
  const verdicts = admissibilityLines(screens);
  if (verdicts.length === 0) {
    lines.push('  no shape in this menu has an admissible gain at any weight');
  } else {
    lines.push(...verdicts);
  }
  return lines.join('\n');
}

/** Render the onset screen. */
export function formatOnsetScreenReport(screen: OnsetScreen, weights: FamilyScreenWeights): string {
  const a = screen.availability;
  const s = screen.solved;
  const lines: string[] = [];
  const at = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : 'unbounded');
  const share =
    a.servicesTotal === 0
      ? 'n/a'
      : `${((100 * a.servicesWithOnset) / a.servicesTotal).toFixed(1)}%`;
  lines.push(
    `Temporal (onset) screen (${configurationLine(weights)}; ` +
      `shape=${screen.shape}` +
      (screen.shape === 'earliness' ? ' (the engine\u2019s own, from its own function)' : '') +
      '):',
  );
  // Availability first, because a zero gain means something completely different
  // depending on it: no evidence is a data gap, evidence with no window is a result.
  lines.push(
    `  evidence: ${a.cases} cases; with an injection anchor ${a.withAnchor}; ` +
      `with an onset ${a.withOnsets}; with an ORDER the term can act on ${a.withEarliness}`,
  );
  lines.push(`  services carrying an onset: ${a.servicesWithOnset}/${a.servicesTotal} (${share})`);
  lines.push(...namedWeightLines(s.at));
  if (a.withEarliness === 0) {
    // Not "no window": the term cannot act at all, so a gain of zero here would be
    // read as a negative result when it is a data gap. Saying which is the whole
    // point of printing availability before the window.
    lines.push(...onsetInertSentence(a));
    return lines.join('\n');
  }
  // The width of the range the line above NAMES — the maximal-gain span the recommendation was
  // taken from — rather than the span to the cap, which includes weights the peak is not held at.
  const width = s.bestEnd - s.gainFloor;
  lines.push(
    `  window: gain ${s.gain} in [${at(s.gainFloor)}, ${at(s.bestEnd)}] ` +
      `(cap ${at(s.window.cap)}; width ${width.toFixed(6)})`,
  );
  lines.push(
    `  ship ${s.ship.toFixed(6)}; lost at ship ${s.lostAtShip}` +
      (s.lostAtShip > 0 ? ' — the criterion’s second half FAILS' : ''),
  );
  const profile = s.steps.filter((step, index) =>
    index === 0 ? step.gained > 0 : step.gained !== s.steps[index - 1]!.gained,
  );
  if (profile.length > 0) {
    lines.push(
      `  profile ${profile.map((step) => `${step.weight.toFixed(6)}→${step.gained}`).join(', ')}`,
    );
  }
  if (s.gain > 0) {
    lines.push(`  gains ${s.gained.join(', ')}`);
    lines.push(
      `  by fault type: ${screen.gainTypes.map((t) => `${t.key} +${t.cases}`).join(', ')}`,
    );
    lines.push(marginLine(s));
    // Immediately after the margin, because the two are read together: the margin is the lead and
    // this is how much of it survives the digits the producer discarded. A screen that named a
    // weight from a count its own inputs cannot resolve is the defect this line exists to make
    // impossible to repeat.
    lines.push(formatResolutionLine(screen.resolution));
    lines.push(formatCapResolutionLine(screen.capNoise, s.ship));
    // After the two ensembles, because it is the question they provoke: every refusal they produce is a
    // resolution bar, and this is the only reading that says whether a FINER render would clear it — so a
    // reader told the count is unresolvable learns here whether that is fixable or structural.
    lines.push(formatRefinementFrontierLine(screen.frontier));
  } else {
    lines.push('  no admissible gain: every weight that fixes a case also loses one');
  }
  if (s.window.capBinder !== undefined) {
    lines.push(
      `  cap bound by ${s.window.capBinder.datapack}: ${s.window.capBinder.target} overtaken by ` +
        `${s.window.capBinder.rival} (lead ${s.window.capBinder.lead.toFixed(6)}, ` +
        `slope gap ${s.window.capBinder.slopeGap.toFixed(6)})`,
    );
  }
  return lines.join('\n');
}

/** The declared shapes of the decisive-stability term. */
export const CV_SHAPES = ['flip', 'rank'] as const;

/**
 * Which reading of "the decisive metric is steadier" a slope encodes.
 *
 * TWO, declared as a menu rather than left to the next proposal, for the reason the onset
 * shapes are: "no weight on THIS shape works" leaves the axis open on a technicality, and the
 * next session finds another shape to propose. The two are different hypotheses about the same
 * statistic — `flip` carries the MAGNITUDE of the coefficient of variation and `rank` carries
 * only its ORDER, so a magnitude dominated by one outlier is a null `rank` does not share.
 */
export type CvShape = (typeof CV_SHAPES)[number];

/** The shape a screen is solved under when the caller names none. */
export const DEFAULT_CV_SHAPE: CvShape = 'flip';

/**
 * The `cv` the block rendered for a service's decisive metric, when it rendered a usable one.
 *
 * ONE owner, because three places must agree on it: {@link cvSlopes} assigns its slope from this
 * value, {@link cvAvailability} counts it, and the window's classes ask whether two services'
 * coefficients are EQUAL because the term read the same number twice or because it read NOTHING.
 * That last question cannot be answered from `slope`, where both arrive as `0` — the least stable
 * service and a service the block never decomposed are indistinguishable there, while the ENGINE
 * tells them apart by leaving the score ABSENT (`pruner.ts` falls back to `0`, an equality of
 * absence rather than a hidden ordering).
 *
 * A non-finite `cv` is a value the block printed and the engine cannot have produced; it is read as
 * absent rather than propagated, because one `NaN` slope would make the case's interval empty and
 * the report would read "no window" for an arithmetic accident.
 *
 * @param service - One parsed service row.
 * @returns The rendered `cv`, or `undefined` when there is none to weigh.
 */
function decisiveCv(service: DiagnosedService): number | undefined {
  const cv = service.decisiveOutcome?.breakdown?.cv;
  return cv === undefined || !Number.isFinite(cv) ? undefined : cv;
}

/**
 * Per-service slope for the decisive-stability term, over ONE case.
 *
 * The separator's own statistic, turned into a coefficient: across the miss pairs the true
 * source's decisive metric has the LOWER coefficient of variation (AUC 0.718 on the
 * inventory-matched stratum), so a term that credits stability rises as `cv` falls.
 *
 * TOTAL over the services, unlike `latencySlopes`: a service the term cannot weigh still carries
 * a base, and omitting it would make the caller default it — which is how "not measured" becomes
 * "measured as zero". A service whose decisive composition the block did not render gets a slope
 * of **0**, i.e. no credit; giving it the term's maximum for a measurement nobody made is the
 * error this whole family exists to avoid.
 *
 * @param services - One case's parsed services.
 * @param shape - Which reading to encode. Defaults to {@link DEFAULT_CV_SHAPE}.
 * @returns One slope per service, zero where the term does not act.
 */
export function cvSlopes(
  services: readonly DiagnosedService[],
  shape: CvShape = DEFAULT_CV_SHAPE,
): Map<string, number> {
  const slopes = new Map<string, number>();
  const measured: { readonly id: string; readonly cv: number }[] = [];
  for (const service of services) {
    slopes.set(service.serviceId, 0);
    const cv = decisiveCv(service);
    if (cv === undefined) continue;
    measured.push({ id: service.serviceId, cv });
  }
  // ONE cv is not a comparison. Stated once, before either shape, so the two agree on when the
  // term is inert — a case cannot be reordered by a distance measured against nothing.
  if (measured.length < 2) return slopes;

  if (shape === 'rank') {
    const ascending = [...measured].sort((a, b) => a.cv - b.cv);
    const n = ascending.length;
    const ranks = new Map<string, number>();
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && ascending[j + 1]!.cv === ascending[i]!.cv) j++;
      // AVERAGED, not positional: two services the statistic cannot tell apart must not be
      // separated by whichever one a sort happened to leave first.
      const shared = (i + j) / 2;
      for (let k = i; k <= j; k++) ranks.set(ascending[k]!.id, shared);
      i = j + 1;
    }
    for (const one of measured) slopes.set(one.id, (n - 1 - ranks.get(one.id)!) / (n - 1));
    return slopes;
  }

  const max = measured.reduce((best, one) => (one.cv > best ? one.cv : best), measured[0]!.cv);
  // Max-normalised like every other fusion term, so the least stable service in the case is the
  // origin and the term is a DISTANCE rather than a level. A `cv` of zero is a real measurement
  // (a perfectly flat series), but a case where every service is flat holds no distance, and
  // manufacturing one would rank on nothing.
  if (max <= 0) return slopes;
  for (const one of measured) slopes.set(one.id, (max - one.cv) / max);
  return slopes;
}

/** How much of a dump the decisive-stability term can act on. */ export interface CvAvailability {
  /** Cases the dump describes and that name at least one acceptable root. */
  readonly cases: number;
  /** Services in total, over every such case. */
  readonly servicesTotal: number;
  /** Services whose decisive composition the block rendered. */
  readonly servicesMeasured: number;
  /**
   * Cases holding at least two DISTINCT measured cvs — the population the term can reorder.
   *
   * The distinction a bare "measured" count cannot express: a case with two measurements that
   * agree carries no more evidence than a case with one, and only this count falls.
   */
  readonly casesComparable: number;
}

/**
 * Count how much decisive-stability evidence a dump carries.
 *
 * @param cases - Parsed cases.
 * @returns The counts.
 */
export function cvAvailability(cases: readonly DiagnosedCase[]): CvAvailability {
  let eligible = 0;
  let servicesTotal = 0;
  let servicesMeasured = 0;
  let casesComparable = 0;
  for (const kase of cases) {
    if (!kase.groundTruth.some((name) => name !== '')) continue;
    eligible++;
    servicesTotal += kase.services.length;
    const seen = new Set<number>();
    for (const service of kase.services) {
      const cv = decisiveCv(service);
      if (cv === undefined) continue;
      servicesMeasured++;
      seen.add(cv);
    }
    // Both declared shapes are strictly monotone in `cv`, so a case with one distinct value is
    // inert under either of them and this count does not depend on the shape.
    if (seen.size > 1) casesComparable++;
  }
  return { cases: eligible, servicesTotal, servicesMeasured, casesComparable };
}

/** WHICH absence stops the stability screen — named, because they close different things. */
export type CvInertCause = 'no-cases' | 'no-composition' | 'no-spread';

/**
 * Why the decisive-stability term cannot act on this artifact.
 *
 * The menu printed ONE sentence for all of these — *"no case holds two distinct coefficients of
 * variation"* — and on an artifact that records no composition at all that claim is TRUE AND VACUOUS
 * while reading as a result about the benchmark. Measured: the FSE'26 dump on disk holds 1422 cases and
 * 72527 service rows and **not one** decisive composition, because it predates the line the composition
 * is rendered on, while a later render of the SAME run reports `71161 of 72527`. So the cause is named:
 * `no-composition` is a gap in the artifact, and only `no-spread` is a result.
 *
 * @param a - The counts the availability pass produced.
 * @returns The first absence that stops the term, in the order they nest.
 */
export function cvInertCause(a: CvAvailability): CvInertCause {
  if (a.cases === 0) return 'no-cases';
  if (a.servicesMeasured === 0) return 'no-composition';
  return 'no-spread';
}

/**
 * The sentence a stability menu prints INSTEAD of a window, with the label its cause earns.
 *
 * @param a - The counts the availability pass produced.
 * @returns One or more indented lines.
 */
export function cvInertSentence(a: CvAvailability): string[] {
  switch (cvInertCause(a)) {
    case 'no-cases':
      return [
        '  the term is UNEVALUABLE on this dump: it names no case with an acceptable root, so there is',
        '  nothing to screen — a gap in the ARTIFACT rather than a result about the data.',
      ];
    case 'no-composition':
      return [
        `  the term is UNEVALUABLE on this dump: its blocks record a decisive composition for NONE of`,
        `  their ${a.servicesTotal} services (0 of ${a.servicesTotal}), so no stability question can be`,
        '  asked OF THIS ARTIFACT — a dump whose producer emitted `metricDecisive` is needed, and a',
        '  spread conclusion is unavailable here in either direction.',
      ];
    default:
      return [
        `  the term is INERT on this dump: the composition IS recorded (${a.servicesMeasured} of`,
        `  ${a.servicesTotal} services) and no case holds two distinct coefficients of variation, so no`,
        '  weight can change a ranking — a window here is an artefact.',
      ];
  }
}

/**
 * One case as the decisive-stability screen scores it: the shipped base plus the term's slope.
 *
 * A function rather than a loop body because {@link gainResolution} has to score a PERTURBED case
 * with the same arithmetic — a resampling that re-derived the base would be measuring a different
 * engine than the window it qualifies, which is the defect this module exists to find.
 *
 * The base is `shippedScores` for the caller's configuration, so the case this is a distance from
 * is the engine that actually ran: the latency and pool terms are IN it, and a screen measured
 * against a two-term blend would report a window for a ranking nobody had.
 *
 * @param kase - One parsed case.
 * @param weights - The configuration to screen against.
 * @param shape - Which reading of the statistic to solve for.
 * @returns The case's affine scores, or `undefined` when it has no ground truth to satisfy.
 */
function stabilityCase(
  kase: DiagnosedCase,
  weights: FamilyScreenWeights,
  shape: CvShape,
): WeightSeparationCase | undefined {
  const targets = kase.groundTruth.filter((name) => name !== '');
  if (targets.length === 0) return undefined;
  const base = shippedScores(kase, {
    logWeight: weights.logWeight,
    latWeight: weights.latWeight ?? SHIPPED_LAT_WEIGHT,
    latFloor: weights.latFloor ?? SHIPPED_LAT_FLOOR,
    poolWeight: weights.poolWeight ?? SHIPPED_POOL_WEIGHT,
    temporalWeight: weights.temporalWeight ?? SHIPPED_TEMPORAL_WEIGHT,
    onsetShape: weights.onsetShape ?? SHIPPED_ONSET_SHAPE,
  });
  const slopes = cvSlopes(kase.services, shape);
  const scores = new Map<string, { base: number; slope: number }>();
  // The provenance, stated because THIS term can weigh only part of a case: `cvSlopes` gives `0` to
  // a service whose decisive composition the block did not render, which is the same value it gives
  // the least stable service. The window's classes ask the difference, and only this builder knows
  // it.
  const weighed = new Set<string>();
  for (const service of kase.services) {
    if (decisiveCv(service) !== undefined) weighed.add(service.serviceId);
    scores.set(service.serviceId, {
      // Total by construction — `shippedScores` assigns an entry to every service, and `cvSlopes`
      // to every service — so the lookups assert rather than defaulting to a base or a slope
      // nobody computed.
      base: base.get(service.serviceId)!,
      slope: slopes.get(service.serviceId)!,
    });
  }
  return { datapack: kase.datapack, targets, scores, weighed };
}

/** One shape of the decisive-stability term, solved. */
export interface CvScreen {
  /** How much of the dump carries a composition at all. */
  readonly availability: CvAvailability;
  /** The shape this window is for. */
  readonly shape: CvShape;
  /** The solved window over the whole dump. */
  readonly solved: SolvedWindow;
  /** The per-fault-type split of the gain — the kill criterion's second half. */
  readonly gainTypes: readonly { readonly key: string; readonly cases: number }[];
  /**
   * What the count survives of the digits the dump discarded.
   *
   * On the object rather than left to the caller because it is a property of THIS measurement: a
   * report that printed `gain 6` and stopped was readable as a claim the artifact cannot support,
   * and a consumer that had to remember to compute this would be a second place for it to go
   * missing.
   */
  readonly resolution: GainResolution;
  /**
   * Where the window's cap lands under the dump's discarded digits — the SECOND channel of cap
   * uncertainty, and the one {@link UnrepresentableFrontier.lossFloor} does not model.
   */
  readonly capNoise: CapResolution;
  /**
   * How much finer the render would have to be before this shape's refusal clears.
   *
   * The same sweep the onset screen runs, through the same function — and the contrast between the two
   * screens' answers is the point: "the render binds this axis" is a claim per (dump, shape), and only a
   * sweep can tell a window that one more digit settles from one no digit does.
   */
  readonly frontier: RefinementFrontier<CvShape>;
}

/**
 * Screen the decisive-stability term for a zero-regression window.
 *
 * The term the separator's own rate licenses: it is the only non-term signal above the criterion
 * on the inventory-matched stratum, and this is the offline instrument that decides whether a
 * weight on it can exist. Solved with the SAME solver and the same shipping rule as the family
 * and onset screens — a window is a window, and the question does not change because the slope
 * came from a dispersion statistic.
 *
 * The base is `shippedScores` for the caller's configuration, so the case this is a distance
 * from is the engine that actually ran. In particular the latency and pool terms are IN the base:
 * a screen measured against a two-term blend would report a window for a ranking nobody had.
 *
 * @param cases - Parsed cases.
 * @param weights - The configuration to screen against.
 * @param shape - Which reading of the statistic to solve for.
 * @returns The availability counts and the solved window.
 */
export function cvScreen(
  cases: readonly DiagnosedCase[],
  weights: FamilyScreenWeights,
  shape: CvShape = DEFAULT_CV_SHAPE,
  at?: number,
): CvScreen {
  const built: WeightSeparationCase[] = [];
  for (const kase of cases) {
    const one = stabilityCase(kase, weights, shape);
    if (one !== undefined) built.push(one);
  }
  const solved = solveZeroRegressionWindow(built, at);
  const faultTypeOf = new Map(cases.map((kase) => [kase.datapack, kase.faultType]));
  const gainTypes = new Map<string, number>();
  for (const datapack of solved.gained) bump(gainTypes, faultTypeOf.get(datapack) ?? '');
  // Built ONCE and shared with the frontier; see `onsetScreen` for why `k = 0` must be these ensembles.
  const screen: GainResolutionScreen = { kind: 'stability', weights, shape };
  const gain: GainResolutionInput = { cases, gained: solved.gained, ship: solved.ship, screen };
  const resolution = gainResolution(gain);
  const capNoise = capResolution({ cases, ship: solved.ship, screen });
  return {
    availability: cvAvailability(cases),
    shape,
    solved,
    gainTypes: tallyCounter(gainTypes),
    resolution,
    capNoise,
    frontier: refinementFrontier({ gain, solved, shape, atArtifact: { resolution, capNoise } }),
  };
}

/**
 * Screen every shape in {@link CV_SHAPES}, in declared order.
 *
 * @param cases - Parsed cases.
 * @param weights - The configuration to screen against.
 * @returns One solved screen per shape.
 */
export function cvShapeMenu(
  cases: readonly DiagnosedCase[],
  weights: FamilyScreenWeights,
  at?: number,
): readonly CvScreen[] {
  return CV_SHAPES.map((shape) => cvScreen(cases, weights, shape, at));
}

/**
 * The unreachable count with the causes it partitions into, as one clause.
 *
 * One owner, because three reports print it: a summary that gave the number without the causes
 * would put a mechanism-less count back in front of a reader who had just been shown what the
 * mechanisms are.
 *
 * The labels carry their own meaning, which is why there is no legend line: this clause appears in
 * a menu summary AND in each shape's detail block below it, and a legend printed with each would
 * be three copies of one sentence. The nuance a bare label cannot carry — that a GENUINE
 * engine-side tie lands in the same class as a render tie — is in {@link UnreachableCauses} and in
 * `docs/fse26-cv-screen.md`.
 *
 * @param window - The solved window.
 * @returns The clause, without a leading space.
 */
function unreachableClause(
  window: Pick<ZeroRegressionWindow, 'unreachable' | 'unreachableByCause'>,
): string {
  const c = window.unreachableByCause;
  return (
    `${window.unreachable} (root without a row ${c.rootWithoutRow}, no spread ${c.noSpread}, ` +
    `unweighed ${c.unweighed}, tied at the render ${c.tiedAtRender}, out of reach ${c.outOfReach})`
  );
}

/**
 * The cap's qualification, as one sentence.
 *
 * One owner because TWO reports print it — a shape's detail, where the cap is named, and the menu's
 * one-liner for a shape whose cap is finite but whose gain is not. The two branches are mutually
 * exclusive per shape, so the sentence appears exactly once for each shape that needs it, and a
 * second copy of it is how the two would come to disagree.
 *
 * @param u - The window's own counts.
 * @param cap - The cap the sentence qualifies.
 * @returns The sentence, without a leading space.
 */
function capUpperBoundClause(u: UnrepresentableFrontier, cap: number): string {
  const binder = u.lossFloorBinder;
  const at = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : 'unbounded');
  // The COMPARISON is the finding, and it is the floor against the cap — NOT "is there a binder",
  // which is a different question: a binder exists whenever the class does, and it is present on both
  // sides of the cap. Reading the wording off the binder's existence would have said `BELOW` about a
  // floor the cap already covers, which is the one thing this sentence must not do.
  //
  // TWO branches and not three, because the CONCLUSION is binary: the engine's cap is at least
  // `min(cap, floor)`, so the channel can hide a loss below the cap exactly when the floor is under
  // it. `AT OR ABOVE` is the wording for the other side because the dumps produce equality — `re1`'s
  // `flip` shape has a floor of `0.008032` against a cap of `0.008032`, two different cases whose
  // leads are the same double — and calling that `ABOVE` would be a claim the numbers do not support.
  const binds = binder !== undefined && u.lossFloor < cap;
  const comparison = binds
    ? `the cap ${at(cap)}, so the engine can lose one first`
    : `the cap ${at(cap)}, so this channel cannot bind below it`;
  return (
    `${u.cases} of ${u.declared} satisfied cases hold a rival the term reads as EQUAL, and the ` +
    `cap’s own case is ${u.setsCap ? '' : 'not '}one of them; the lowest weight at which one of them ` +
    `can be lost is ${at(u.lossFloor)}` +
    (binder === undefined
      ? ''
      : ` (${binder.datapack}: ${binder.target} / ${binder.rival}, a tie group of ${binder.group} ` +
        `among ${binder.weighed} weighed)`) +
    ` — ${binds ? 'BELOW' : 'AT OR ABOVE'} ${comparison}`
  );
}

/**
 * Render one shape's decisive-stability screen.
 *
 * @param screen - The solved screen.
 * @param weights - The configuration it was solved at, for the header.
 * @returns A multi-line report, without a trailing newline.
 */
export function formatCvScreenReport(screen: CvScreen, weights: FamilyScreenWeights): string {
  const a = screen.availability;
  const s = screen.solved;
  const at = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : 'unbounded');
  const share =
    a.servicesTotal === 0 ? 'n/a' : `${((100 * a.servicesMeasured) / a.servicesTotal).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(
    `Decisive-stability screen (${configurationLine(weights)}; shape=${screen.shape}` +
      (screen.shape === DEFAULT_CV_SHAPE
        ? ' (the magnitude of cv; the shape the rate was measured on)'
        : ' (the order of cv alone)') +
      '):',
  );
  // Availability first, because a zero gain means something different depending on it: an
  // unrendered composition is a data gap, a measured spread with no window is a result.
  lines.push(
    `  evidence: ${a.cases} cases; with a decisive composition ${a.servicesMeasured} of ` +
      `${a.servicesTotal} services; with a SPREAD the term can act on ${a.casesComparable}`,
  );
  lines.push(
    `  services carrying a decisive composition: ${a.servicesMeasured}/${a.servicesTotal} ` +
      `(${share})`,
  );
  // The population this window protects. A gain with no population is unreadable — `gain 4` means
  // one thing out of 3 correct cases and another out of 700. `cases` and `correct at 0` come from
  // the BASE, which no shape touches, and `correct at 0` is also the instrument's fidelity line
  // because the base IS the shipped score; `unreachable` is this SHAPE's own count, since an empty
  // admissible set is decided by the slopes and the shapes give the same order different spacing.
  // It is printed WITH its causes: the count alone reads the same whether the term has no input
  // here, reads a deciding pair as equal, or cannot reach — and those close different axes.
  lines.push(
    `  cases ${s.window.cases}; correct at 0 ${s.window.satisfied}; ` +
      `unreachable at every weight ${unreachableClause(s.window)}`,
  );
  lines.push(...namedWeightLines(s.at));
  if (a.casesComparable === 0) {
    lines.push(...cvInertSentence(a));
    return lines.join('\n');
  }
  // The width of the range the line above NAMES — the maximal-gain span the recommendation was
  // taken from — rather than the span to the cap, which includes weights the peak is not held at.
  const width = s.bestEnd - s.gainFloor;
  lines.push(
    `  window: gain ${s.gain} in [${at(s.gainFloor)}, ${at(s.bestEnd)}] ` +
      `(cap ${at(s.window.cap)}; width ${width.toFixed(6)})`,
  );
  lines.push(
    `  ship ${s.ship.toFixed(6)}; lost at ship ${s.lostAtShip}` +
      (s.lostAtShip > 0 ? ' — the criterion’s second half FAILS' : ''),
  );
  const profile = s.steps.filter((step, index) =>
    index === 0 ? step.gained > 0 : step.gained !== s.steps[index - 1]!.gained,
  );
  if (profile.length > 0) {
    lines.push(
      `  profile ${profile.map((step) => `${step.weight.toFixed(6)}→${step.gained}`).join(', ')}`,
    );
  }
  if (s.gain > 0) {
    lines.push(`  gains ${s.gained.join(', ')}`);
    lines.push(
      `  by fault type: ${screen.gainTypes.map((t) => `${t.key} +${t.cases}`).join(', ')}`,
    );
    lines.push(marginLine(s));
    // Immediately after the margin, because the two are read together: the margin is the lead and
    // this is how much of it survives the digits the producer discarded. A screen that named a
    // weight from a count its own inputs cannot resolve is the defect this line exists to make
    // impossible to repeat.
    lines.push(formatResolutionLine(screen.resolution));
    // Directly after the margin's own ensemble, because the two answer the two halves of one
    // question: that one says whether the GAINS survive the discarded digits, this says whether the
    // WINDOW'S OWN right-hand end does. A reader just told the gain count is unresolvable needs to know
    // whether the weight it is measured at is inside its own cap's noise.
    lines.push(formatCapResolutionLine(screen.capNoise, s.ship));
    // The frontier, last: the two ensembles above say WHAT is unresolved, and this is the only line that
    // says whether a finer render would resolve it. See the onset report's identical line.
    lines.push(formatRefinementFrontierLine(screen.frontier));
  } else {
    lines.push('  no admissible gain: every weight that fixes a case also loses one');
  }
  if (s.window.capBinder !== undefined) {
    lines.push(
      `  cap bound by ${s.window.capBinder.datapack}: ${s.window.capBinder.target} overtaken by ` +
        `${s.window.capBinder.rival} (lead ${s.window.capBinder.lead.toFixed(6)}, ` +
        `slope gap ${s.window.capBinder.slopeGap.toFixed(6)})`,
    );
  }
  // The cap's own qualification, and it is a SEPARATE line from the binder above rather than a
  // clause inside it: the binder names ONE pair, while the question here is about the whole
  // satisfied population — and a binder line carrying a number about other cases would read as a
  // property of the pair it names. Printed only when it applies: a line that always said
  // `0 of N` would be read as a passing check instead of as the absence of a finding.
  const u = s.window.capUnrepresentable;
  if (u.cases > 0) lines.push(`  cap UPPER bound: ${capUpperBoundClause(u, s.window.cap)}`);
  return lines.join('\n');
}

/**
 * Render the whole shape menu.
 *
 * Availability once, before any window, for the reason the onset menu prints it once: it is a
 * property of the DUMP rather than of a shape, and an inert term would give every row below a
 * `gain 0` that reads like a verdict on the shape.
 *
 * @param screens - The solved screens, one per shape.
 * @param weights - The configuration they were solved at, for the header.
 * @returns A multi-line report, without a trailing newline.
 */
export function formatCvMenuReport(
  screens: readonly CvScreen[],
  weights: FamilyScreenWeights,
): string {
  const first = screens[0];
  if (first === undefined) return 'Decisive-stability screen: no shape was screened';
  const a = first.availability;
  const lines: string[] = [];
  lines.push(`Decisive-stability screen (${configurationLine(weights)}):`);
  const share =
    a.servicesTotal === 0 ? 'n/a' : `${((100 * a.servicesMeasured) / a.servicesTotal).toFixed(1)}%`;
  lines.push(
    `  evidence: ${a.cases} cases; with a decisive composition ${a.servicesMeasured} of ` +
      `${a.servicesTotal} services; with a SPREAD the term can act on ${a.casesComparable}`,
  );
  lines.push(
    `  services carrying a decisive composition: ${a.servicesMeasured}/${a.servicesTotal} ` +
      `(${share})`,
  );
  // TWO of the three counts are properties of the BASE, which no shape touches: how many cases the
  // dump describes, and how many the shipped score gets right. `correct at 0` is also the
  // instrument's fidelity line, because the base IS the shipped score.
  //
  // The third is NOT. `unreachable` counts cases whose admissible set is EMPTY, and emptiness is
  // decided by the slopes, so the shapes can disagree — measured on run `35107871516`, `flip` 569
  // against `rank` 526 over the same 1422 cases. It is therefore printed beside the shape it
  // belongs to: one shape's number above a two-row table is a number about neither row.
  lines.push(`  cases ${first.solved.window.cases}; correct at 0 ${first.solved.window.satisfied}`);
  lines.push(
    '  unreachable at every weight: ' +
      screens
        .map((screen) => `${screen.shape} ${unreachableClause(screen.solved.window)}`)
        .join(', '),
  );
  if (a.casesComparable === 0) {
    lines.push(...cvInertSentence(a));
    // Same reason as the onset menu's identical placement: the verdict precedes the exit, because
    // the menu returns before the loop that renders a shape's detail.
    for (const screen of screens) lines.push(...namedWeightLines(screen.solved.at));
    return lines.join('\n');
  }
  lines.push('  shape          gain  window                     width     ship      binder');
  for (const screen of screens) {
    const s = screen.solved;
    const at = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : 'unbounded');
    const width = Number.isFinite(s.window.cap)
      ? s.window.cap - s.gainFloor
      : Number.POSITIVE_INFINITY;
    lines.push(
      `  ${screen.shape.padEnd(14)}${String(s.gain).padStart(3)}  ` +
        `[${at(s.gainFloor)}, ${at(s.window.cap)}]`.padEnd(25) +
        `${(Number.isFinite(width) ? width.toFixed(6) : 'unbounded').padStart(10)}  ` +
        `${s.ship.toFixed(6).padStart(9)}  ` +
        `${s.window.capBinder === undefined ? '-' : s.window.capBinder.datapack}`,
    );
  }
  // The detail is printed for any shape with a gain, and the binder for every FINITE cap: a row
  // of zeros with no mechanism is a verdict nobody can act on or refute.
  for (const screen of screens) {
    const s = screen.solved;
    // Same reason as the onset menu's identical guard: a named weight's verdict must survive a menu
    // whose every row reads `gain 0`.
    if (s.gain > 0 || s.at !== undefined) {
      lines.push('');
      lines.push(...formatCvScreenReport(screen, weights).split('\n').slice(4));
    } else if (s.window.capBinder !== undefined) {
      const b = s.window.capBinder;
      lines.push(
        `  ${screen.shape}: no admissible gain; cap ${s.window.cap.toFixed(6)} = ` +
          `${b.lead.toFixed(6)} / ${b.slopeGap.toFixed(6)}, bound by ${b.datapack} ` +
          `(${b.target} overtaken by ${b.rival})`,
      );
    }
    // The cap's qualification for a shape whose DETAIL is not printed above. Without this branch the
    // menu states a cap on the face of it for exactly the shapes that have no gain — and `re1`'s
    // `rank` shape, the one the engine's own comparison is read on, is such a shape.
    if (s.gain === 0 && s.at === undefined && s.window.capUnrepresentable.cases > 0) {
      lines.push(
        `    cap UPPER bound: ${capUpperBoundClause(s.window.capUnrepresentable, s.window.cap)}`,
      );
    }
  }
  // The same ONE owner as the temporal menu, over the same four fields: this menu carried a verbatim
  // copy of the blind rule, so a `cv` shape whose window was inside its own noise was listed as
  // admissible by the line under a report that said so.
  const verdicts = admissibilityLines(screens);
  if (verdicts.length === 0) {
    lines.push('  no shape in this menu has an admissible gain at any weight');
  } else {
    lines.push(...verdicts);
  }
  return lines.join('\n');
}

/**
 * Screen every observed dominant-metric family for a zero-regression window.
 *
 * This is the systematic form of the hand-registered family sets the pool penalty was
 * chosen from: instead of naming twelve sets and measuring each, it solves a window for
 * every family the dump carries — including the ones with no gain, because whether an
 * axis was screened and found worthless is the difference between a closed question and
 * an open one.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's configuration.
 * @param families - Families to screen; defaults to every family observed in the dump.
 * @returns One solved row per family, ranked by gain.
 */
export function familyScreen(
  cases: readonly DiagnosedCase[],
  weights: FamilyScreenWeights,
  families?: readonly string[],
): readonly FamilyScreenRow[] {
  const labelsByFamily = new Map<string, Set<string>>();
  const servicesByFamily = new Map<string, number>();
  const casesByFamily = new Map<string, number>();
  for (const kase of cases) {
    const seen = new Set<string>();
    for (const service of kase.services) {
      const family = dominantFamily(service.dominantMetric);
      const labels = labelsByFamily.get(family) ?? new Set<string>();
      labels.add(service.dominantMetric);
      labelsByFamily.set(family, labels);
      bump(servicesByFamily, family);
      if (!seen.has(family)) {
        seen.add(family);
        bump(casesByFamily, family);
      }
    }
  }

  // Every family the dump carries, or exactly the ones asked for: an explicit request is
  // answered with a zero row rather than with no row, so a caller cannot read "skipped"
  // as "screened and empty".
  const requested = families ?? [...labelsByFamily.keys()];
  const faultTypeOf = new Map(cases.map((kase) => [kase.datapack, kase.faultType]));
  const rows: FamilyScreenRow[] = [];
  for (const family of requested) {
    const built = buildFamilyCases(cases, weights, family);
    // The window, the profile, the maximal-gain range and the shipped midpoint all
    // come from ONE solver, shared with the onset screen: two axes chosen by two
    // rules is how a repo ends up unable to compare them.
    const solved = solveZeroRegressionWindow(built);
    const gainTypes = new Map<string, number>();
    for (const datapack of solved.gained) bump(gainTypes, faultTypeOf.get(datapack) ?? '');
    const labels = [...(labelsByFamily.get(family) ?? new Set<string>())].sort();
    rows.push({
      family,
      labels,
      services: servicesByFamily.get(family) ?? 0,
      cases: casesByFamily.get(family) ?? 0,
      gain: solved.gain,
      gainTypes: tallyCounter(gainTypes),
      gained: solved.gained,
      margins: solved.margins,
      unreachable: solved.window.unreachable,
      unreachableByCause: solved.window.unreachableByCause,
      satisfied: solved.window.satisfied,
      cap: solved.window.cap,
      gainFloor: solved.gainFloor,
      bestEnd: solved.bestEnd,
      steps: solved.steps,
      ship: solved.ship,
      capBinder: solved.window.capBinder,
      lostAtShip: solved.lostAtShip,
      resolution: gainResolution({
        cases,
        gained: solved.gained,
        ship: solved.ship,
        screen: { kind: 'family', weights, family },
      }),
      // The prefix is the engine's, imported: a second copy of it could drift to a family
      // the engine does not penalise while every row here stayed green.
      enginePoolFamily: labels.some((label) => label.startsWith(POOL_METRIC_PREFIX)),
    });
  }
  // Gain descending, then the WIDER window, then the name. The width matters because two
  // families worth the same cases are not equally robust: the one whose window is wider is
  // the one a converter revision is less likely to invalidate.
  return rows.sort((a, b) => {
    if (b.gain !== a.gain) return b.gain - a.gain;
    const widthA = Number.isFinite(a.cap) ? a.cap - a.gainFloor : Number.POSITIVE_INFINITY;
    const widthB = Number.isFinite(b.cap) ? b.cap - b.gainFloor : Number.POSITIVE_INFINITY;
    if (widthB !== widthA) return widthB - widthA;
    return a.family < b.family ? -1 : 1;
  });
}

/** Increment a counter. */
function bump(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

/** Tally a counted map into a descending, then name-ordered list. */
function tallyCounter(counter: ReadonlyMap<string, number>): readonly {
  readonly key: string;
  readonly cases: number;
}[] {
  return [...counter.entries()]
    .map(([key, cases]) => ({ key, cases }))
    .sort((a, b) => b.cases - a.cases || (a.key < b.key ? -1 : 1));
}

/**
 * Render the family screen.
 *
 * @param rows - The solved rows.
 * @param weights - The configuration they were solved at, for the header.
 * @returns A multi-line report, without a trailing newline.
 */
export function formatFamilyScreenReport(
  rows: readonly FamilyScreenRow[],
  weights: FamilyScreenWeights,
): string {
  const lines: string[] = [];
  const at = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : 'unbounded');
  lines.push(
    'Family screen (term = −[dominant family == F]; base = the SHIPPED score; ' +
      'window SOLVED, not swept):',
  );
  lines.push(`  configuration: ${configurationLine(weights)}`);
  if (rows.length === 0) {
    lines.push('  no family is present in this dump');
    return lines.join('\n');
  }
  lines.push(
    `  protected at w=0: ${rows[0]!.satisfied} cases per row; ` +
      'gain counts only cases a zero-regression weight reaches',
  );
  lines.push(
    '  family                          gain  window                     width     ' +
      'ship      svcs/cases  labels',
  );
  for (const row of rows) {
    const marker = row.enginePoolFamily ? ' *' : '  ';
    // A window of width ZERO has no interior: at exactly the cap nothing is lost, and one
    // float above it a currently-correct case is. Printed as `point` rather than as
    // `0.000000`, because the two rows would otherwise read as the same kind of object.
    const width = !Number.isFinite(row.cap)
      ? 'unbounded'
      : row.cap - row.gainFloor <= 0
        ? 'point'
        : (row.cap - row.gainFloor).toFixed(6);
    lines.push(
      `  ${(row.family + marker).padEnd(32)}${String(row.gain).padStart(3)}  ` +
        `[${at(row.gainFloor)}, ${at(row.cap)}]`.padEnd(25) +
        `${width.padStart(10)}  ` +
        `${row.ship.toFixed(6).padStart(9)}  ` +
        `${String(row.services).padStart(4)}/${String(row.cases).padEnd(5)}  ` +
        `${row.labels.slice(0, 3).join(', ')}${row.labels.length > 3 ? ', …' : ''}`,
    );
  }
  lines.push("  * the family the engine's own pool penalty already subtracts from");
  lines.push('');
  for (const row of rows) {
    if (row.gain === 0) continue;
    lines.push(
      `  ${row.family}: +${row.gain} (${row.gainTypes
        .map((type) => `${type.key} +${type.cases}`)
        .join(', ')}) · lost at ship ${row.lostAtShip} · unreachable ${unreachableClause(row)}`,
    );
    lines.push(
      `    gains ${row.gained.slice(0, 4).join(', ')}${row.gained.length > 4 ? ', …' : ''}`,
    );
    // The profile, with the entries that do not change the count dropped: a family whose
    // maximum sits at a single weight can still be shippable at a smaller one, and that is
    // not visible in the maximum or in the interval.
    const profile = row.steps.filter((step, index) =>
      index === 0 ? step.gained > 0 : step.gained !== row.steps[index - 1]!.gained,
    );
    if (profile.length > 0) {
      lines.push(
        `    profile ${profile.map((step) => `${step.weight.toFixed(6)}→${step.gained}`).join(', ')}`,
      );
    }
    lines.push(`  ${marginLine(row).trimStart()}`);
    lines.push(formatResolutionLine(row.resolution));
    if (row.capBinder !== undefined) {
      lines.push(
        `    cap bound by ${row.capBinder.datapack}: ${row.capBinder.target} overtaken by ` +
          `${row.capBinder.rival} (lead ${row.capBinder.lead.toFixed(6)}, ` +
          `slope gap ${row.capBinder.slopeGap.toFixed(6)})`,
      );
    }
  }
  const positive = rows.filter((row) => row.gain > 0);
  if (positive.length === 0) {
    lines.push('  no family has an admissible gain: every window buys nothing at w > 0');
  }
  return lines.join('\n');
}

/** One line naming the configuration a screen was solved at. */
function configurationLine(weights: FamilyScreenWeights): string {
  return (
    `logWeight=${weights.logWeight} latWeight=${weights.latWeight ?? SHIPPED_LAT_WEIGHT} ` +
    `latFloor=${weights.latFloor ?? SHIPPED_LAT_FLOOR} ` +
    `poolWeight=${weights.poolWeight ?? SHIPPED_POOL_WEIGHT}`
  );
}

/**
 * One line naming the frontier of a solved window.
 *
 * The count cannot be read to the precision the decision needs on its own. The margin is the lead
 * the thinnest gained case holds over its nearest rival at the shipped weight, and the rank step is
 * one position of THAT case's own term — so `1.054e-4` against a step of `6.034e-4` says the weight
 * is a tenth of a rank away from losing a case, while `1.2e-2` against the same step says a whole
 * rank would still not cost it. The population of gains inside one step is counted against each
 * case's own step, because the step scales with the weight and with how many services the case
 * ranks over; the value printed is the thinnest case's.
 *
 * @param solved - A solved window, or any row carrying its margins. Its caller passes one only
 *   when something was GAINED, and a gain is a case satisfied at the shipped weight — so it has a
 *   leading root and a nearest rival there, and the list is non-empty by construction.
 * @returns The line.
 */
function marginLine(solved: { readonly margins: readonly WindowGainMargin[] }): string {
  const thinnest = solved.margins[0]!;
  const inside = solved.margins.filter((one) => one.margin <= one.quantum).length;
  return (
    `  margin: thinnest ${thinnest.margin.toExponential(3)} ` +
    `(${thinnest.datapack} vs ${thinnest.rival}); one rank step ${thinnest.quantum.toExponential(3)}; ` +
    `${inside} of ${solved.margins.length} gains inside one step`
  );
}

/**
 * What a dump that does NOT declare a precision was rendered with.
 *
 * Every dump written before the header carried the field is in this state — the 141 MiB FSE'26 dump and all
 * seven RCAEval dumps — and their precision is a HISTORICAL fact rather than the producer's current default:
 * `toFixed(HISTORICAL_FIELD_DECIMALS)` is what wrote them, whatever the default becomes.
 *
 * A separate binding on purpose, and the distinction is invisible while the two agree. Naming the producer's
 * default here would satisfy every assertion today and silently re-model the whole archive the day that
 * default moves — which is precisely the failure the header field was added to end.
 */
export const HISTORICAL_FIELD_DECIMALS = 3;

/**
 * Half the smallest difference a render at `decimals` places can express — the ONE owner of a cell's width.
 *
 * `toFixed(3)` maps a value onto the nearest `0.001`, so a field printed as `0.960` stands for anything in
 * `[0.9595, 0.9605)`. A parameter rather than a constant because the width is a property of the ARTIFACT:
 * every caller that used one constant was modelling the dump it expected, and a copy of `3` would keep
 * drawing `5.0e-4` for a dump that says six decimals — the claim it qualifies going wrong without a test.
 */
export function halfQuantumFor(decimals: number): number {
  return 0.5 * 10 ** -decimals;
}

/**
 * The precision an artifact was rendered with, and whether the artifact SAID so.
 *
 * Two fields rather than one, because the two facts have different consequences: a stated precision is a
 * property of the artifact, while an inferred one is a claim the READER is making — and a report that printed
 * `±1.0e-3` without saying which would let an inference pass as a measurement.
 */
export interface DumpPrecision {
  /** The decimals the per-service fields were rendered with. */
  readonly decimals: number;
  /** True when the dump declared it; false when the reader supplied {@link HISTORICAL_FIELD_DECIMALS}. */
  readonly stated: boolean;
}

/**
 * The precision of one dump, from the cases it was parsed into — the ONE place `undefined` becomes a number.
 *
 * The cases of one dump share a header, so they share a precision; a set that disagreed would mean two
 * artifacts concatenated, which the parser already treats as two blocks. The first case's answer is therefore
 * the answer, and an EMPTY set is reported as an unstated historical render because there is no artifact to
 * have stated anything — a caller with no cases has no numbers to draw either.
 *
 * @param cases - The parsed cases of one dump.
 * @returns What the artifact declared, or the historical precision with `stated: false`.
 */
export function dumpPrecisionOf(cases: readonly DiagnosedCase[]): DumpPrecision {
  const declared = cases[0]?.fieldDecimals;
  return declared === undefined
    ? { decimals: HISTORICAL_FIELD_DECIMALS, stated: false }
    : { decimals: declared, stated: true };
}

/**
 * How many resamplings {@link gainResolution} reports over.
 *
 * 400 is the point where the histogram's tail is stable at the precision the report prints (one
 * decimal of a percentage) while the whole ensemble stays under a second: it perturbs only the
 * cases the window NAMES, which is a handful, not the dump's 1422.
 */
export const GAIN_RESOLUTION_TRIALS = 400;

/**
 * How many resamplings {@link capResolution} reports over.
 *
 * FEWER than the gain ensemble, and for a reason that is about cost rather than statistics: each draw
 * here re-solves the WHOLE window, where the gain ensemble perturbs only the handful of cases the window
 * names. Measured on the FSE'26 dump (1422 cases, 2.3 s for the whole two-shape screen): one solve is
 * ~5 ms, so 100 draws is ~0.5 s per screen and 400 would be ~2 s of pure re-solving. 100 draws already
 * resolve the cap to 1% of the range the report prints it over, which is two orders finer than the
 * `1e-3` quantum they are drawn from.
 */
export const CAP_RESOLUTION_TRIALS = 100;

/**
 * The seed of the resampling sequence.
 *
 * A CONSTANT, not a clock: two runs over the same dump must print the same ensemble, or a reader
 * cannot tell a revision of the dump from a revision of the draw and the number stops being a
 * measurement. The sequence itself is irrelevant to the estimate — it only has to be fixed and
 * reproducible.
 */
const GAIN_RESOLUTION_SEED = 20260916;

/** How far a screen's headline count survives the digits the dump discarded. */
export interface GainResolution {
  /** Resamplings drawn. */
  readonly trials: number;
  /**
   * The box these draws came from — quanta, columns, the ARTIFACT's declared precision and the refinement.
   *
   * Reported rather than held privately, because the line that prints the result has to name the resolution
   * it drew IN, and because the numbers here are a statement about the dump only at `extraDigits: 0`: a reader
   * who cannot see which box produced them would read a hypothetical as a measurement. Carrying the precision
   * also means a line quoting a quantum reads it from the same object the draws came from, instead of from a
   * module constant that describes a different artifact.
   */
  readonly box: ResolutionBox;
  /** Trials by how many of `gained` held; index = that count, so it always sums to `trials`. */
  readonly histogram: readonly number[];
  /** The fewest that ever held — a SOUND lower bound on the count over the quantum's box. */
  readonly least: number;
  /** The most that ever held; `gained.length` unless the centre is itself outside the box. */
  readonly most: number;
  /** Gains that held in EVERY trial — the ones the dump can actually decide. */
  readonly resolved: readonly string[];
  /** Trials in which each gain held, in `gained` order. */
  readonly held: readonly number[];
}

/**
 * Draw one value from the interval a printed field stands for: `[-q, +q]`, uniform.
 *
 * Uniform rather than adversarial because the question is not "could this be lost" — the answer
 * would be yes for every gain, since any lead can be closed by putting the whole quantum on one
 * side of it — but "how much of the box still satisfies it", which is what a reader needs to tell a
 * margin that is 1e-4 from one that is 1e-2. The adversarial corner is the `least` field's worst
 * case and is reported as `0 of k` when it happens; the distribution is what makes the count
 * readable in between.
 *
 * @param next - The next draw in `[0, 1)`.
 * @param halfQuantum - Half the smallest difference the field's render can express. Taken as an
 *   argument rather than read from a constant because the same draw has to serve the artifact's own box
 *   AND a hypothetical finer one; the owner of that choice is {@link resolutionBoxFor}.
 * @returns The offset in `[-halfQuantum, +halfQuantum]`.
 */
function quantumDraw(next: () => number, halfQuantum: number): number {
  return (next() * 2 - 1) * halfQuantum;
}

/**
 * The columns an ensemble draws, beyond the base fields every screen reads.
 *
 * The base — `selfAnomaly`, `logScore`, `latRise` — is in EVERY screen's box, because every screen's
 * base is `shippedScores` over those three. What varies is the column the screen takes its SLOPE from,
 * and it is a different column per screen: the decisive-stability screen reads `cv`, the temporal
 * screen reads the millisecond-rounded onset delay, and a family's slopes come from the `logic`/`http`/
 * `both` counts, which are exact integers with no discarded fraction at all.
 *
 * A single fixed set was the defect this type exists to remove: the box was the STABILITY screen's, so
 * the temporal screen's ensemble held its own only input fixed and reported the resulting stillness as
 * a result. Measured on run `35107871516`, `earliest-only` survives **22 of 100** draws of ±0.5 ms
 * while the report that never drew that field printed `100.0%`.
 */
export interface JitterFields {
  /** Whether the screen's slope comes from the rendered `cv`. */
  readonly cv: boolean;
  /** Whether it comes from the onset delay, rendered in WHOLE milliseconds. */
  readonly onset: boolean;
}

/**
 * The box one screen's ensembles draw — the single owner linking a screen to the fields it reads.
 *
 * Derived from the same declaration that chooses the rebuild, so a caller cannot resample a different
 * screen's box than the arithmetic it is measuring: `gainResolution` and `capResolution` both take the
 * screen and ask this function, rather than accepting a set from their caller.
 *
 * @param screen - Which screen's arithmetic is being measured.
 * @returns The two extra columns to draw, each `false` where the screen cannot read it.
 */
export function jitterFieldsFor(screen: GainResolutionScreen): JitterFields {
  if (screen.kind === 'stability') return { cv: true, onset: false };
  if (screen.kind === 'onset') return { cv: false, onset: true };
  // A family's slope is a COUNT of log lines or a metric label lookup, both exact: there is no
  // discarded fraction in an integer, and drawing one would model noise the format does not have.
  return { cv: false, onset: false };
}

/**
 * One draw of an onset delay, inside the cell its print stands for.
 *
 * Its own function because the cell is NOT symmetric: the renderer prints `-` for any negative delay,
 * so a printed `0` stands for `[0, 0.5]` and nothing below it. A draw that went negative would take a
 * service out of the engine's `delay >= 0` filter — a value the artifact would have had to spell
 * DIFFERENTLY rather than one it discarded, which is a modelling error and not extra conservatism.
 * Measured on run `35107871516`, dropping that clamp moves the `earliest-only` window in 78 of 100
 * draws against 34 of 60 with it.
 *
 * @param printedMs - The delay as the dump records it, in whole milliseconds.
 * @param unit - The next draw in `[0, 1)`.
 * @param halfQuantum - Half the step the render steps in; {@link ONSET_FIELD_HALF_QUANTUM} unless a
 *   caller is sweeping the refinement, in which case {@link resolutionBoxFor} supplies its own.
 * @returns The drawn delay, never negative.
 */
export function drawOnsetDelay(
  printedMs: number,
  unit: number,
  halfQuantum: number = ONSET_FIELD_HALF_QUANTUM,
): number {
  return Math.max(0, printedMs + (unit * 2 - 1) * halfQuantum);
}

/**
 * The half-quanta one screen's ensembles draw, off the artifact its cases came from.
 *
 * ONE owner for the box, because a box is two numbers that must agree with a set of flags AND a declared
 * precision: the screen decides WHICH columns are drawn ({@link jitterFieldsFor}), the artifact decides HOW
 * FINELY each is printed ({@link DumpPrecision}), and the caller's `extraDigits` decides the sweep. Composing
 * them here is what stops a caller from drawing the onset column at the decimals quantum, from drawing a
 * stability screen's column at all, or — the defect this signature exists for — from modelling a dump at the
 * precision of a constant this module happens to share with the producer.
 *
 * `precision` is REQUIRED rather than defaulted: a caller that has cases has an artifact, and a default here
 * would be the same assumption one level down, in a place where nothing could report it.
 *
 * `extraDigits` is the REFINEMENT, and it is a scale rather than a fudge factor: `0` is the artifact's own
 * box, and `k` asks what the ensemble would say if every rendered field carried `k` more digits. It exists
 * because "the render is what binds" is a claim about SCALE — a window whose deciding gaps sit at `1e-4` is
 * settled by one more digit, while one decided by a rendered tie is settled by no number of them — and a
 * claim about scale has to be measured at more than one scale. Every field's OWN quantum is scaled, rather
 * than one factor applied to the base, so each column stays at the resolution its own render has.
 *
 * @param screen - Which screen's arithmetic is being measured.
 * @param precision - What the artifact declared, from {@link dumpPrecisionOf}.
 * @param extraDigits - How many more digits every rendered field is imagined to carry.
 * @returns The box: both quanta, the columns they were built for, the precision and the refinement.
 */
export function resolutionBoxFor(
  screen: GainResolutionScreen,
  precision: DumpPrecision,
  extraDigits = 0,
): ResolutionBox {
  const scale = 10 ** -extraDigits;
  const fields = jitterFieldsFor(screen);
  return {
    service: halfQuantumFor(precision.decimals) * scale,
    onset: fields.onset ? ONSET_FIELD_HALF_QUANTUM * scale : 0,
    fields,
    precision,
    extraDigits,
  };
}

/**
 * The two quanta one screen reads at, with everything that chose them.
 *
 * Carried together so {@link jitterCase} cannot be handed a box that disagrees with the columns it was
 * told to draw (the flags ARE the box's `onset > 0`, by construction in {@link resolutionBoxFor}), and so
 * that a line PRINTING a quantum reads it from the same object the draws came from: the formatter used to
 * quote a module constant, which is the same wrong owner one step later.
 */
export interface ResolutionBox {
  /** Half-quantum for `selfAnomaly`, `logScore`, `latRise`, and `cv` when that column is drawn. */
  readonly service: number;
  /** Half-quantum for the whole-millisecond onset delay; `0` when the screen does not read it. */
  readonly onset: number;
  /** Which extra columns the box was built for. */
  readonly fields: JitterFields;
  /** The precision the ARTIFACT declared, and whether it declared it. */
  readonly precision: DumpPrecision;
  /** How many more digits every field is imagined to carry; `0` is the artifact's own box. */
  readonly extraDigits: number;
}

/**
 * One case as the dump could have recorded it, for any value of the digits it discarded.
 *
 * The base fields are always drawn: `selfAnomaly` ranks the metric term, `logScore` carries the log
 * term at weight 1, and `latRise` carries the latency term through its mask — every screen's base
 * reads all three, at the {@link SERVICE_FIELD_DECIMALS} the renderer prints them with. The screen's
 * own slope column is drawn when `fields` says so, and `cv` and the onset delay are drawn at DIFFERENT
 * resolutions because the producer renders them differently: three decimals for `cv`, whole
 * milliseconds for the onset (`ONSET_FIELD_HALF_QUANTUM`).
 *
 * `failedEdgeScore`, the counts and the labels are left alone — a count is exact and a label is not a
 * number, so perturbing them would be modelling noise the format does not have.
 *
 * @param kase - One parsed case.
 * @param next - The next draw in `[0, 1)`.
 * @param box - The quanta and the columns this screen reads; see {@link resolutionBoxFor}.
 * @returns The case with every read field moved by its own quantum.
 */
function jitterCase(kase: DiagnosedCase, next: () => number, box: ResolutionBox): DiagnosedCase {
  const fields = box.fields;
  return {
    ...kase,
    services: kase.services.map((service) => {
      const breakdown = service.decisiveOutcome?.breakdown;
      return {
        ...service,
        selfAnomaly: service.selfAnomaly + quantumDraw(next, box.service),
        logScore: service.logScore + quantumDraw(next, box.service),
        latRise:
          service.latRise === undefined
            ? undefined
            : service.latRise + quantumDraw(next, box.service),
        // Drawn ONLY when the screen reads it, and at the millisecond render's own resolution rather
        // than the base's: a draw of ±5.0e-4 on a field whose print steps in whole milliseconds would
        // be three orders of magnitude too small to move a single order statistic.
        // Through its own draw, which is where the cell's one-sidedness at zero lives. The guard is
        // `box.onset === 0` rather than a call with a zero quantum, because a draw SPENT there would
        // shift the sequence every later field reads — the box would be identical and the numbers
        // would not.
        onsetDelayMs:
          box.onset === 0 || service.onsetDelayMs === undefined
            ? service.onsetDelayMs
            : drawOnsetDelay(service.onsetDelayMs, next(), box.onset),
        decisiveOutcome:
          breakdown === undefined || service.decisiveOutcome === undefined
            ? service.decisiveOutcome
            : {
                ...service.decisiveOutcome,
                breakdown: {
                  ...breakdown,
                  cv: fields.cv ? breakdown.cv + quantumDraw(next, box.service) : breakdown.cv,
                },
              },
      };
    }),
  };
}

/**
 * A linear congruential sequence, so the ensemble is a function of the dump and the seed alone.
 *
 * Numerical Recipes' constants: the period (2^32) is far above the 400 draws used, and the
 * low-order-bit weakness of an LCG is irrelevant here because each draw is scaled to a real offset
 * and no test of the sequence is made. A seeded sequence is what makes this a reproducible
 * measurement rather than an experiment.
 *
 * @param seed - The starting state.
 * @returns A generator of draws in `[0, 1)`.
 */
function seededUnit(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Which screen's arithmetic a resampling is measured through.
 *
 * A union rather than a scoring callback, so that "resample the weight I am about to recommend"
 * cannot be answered with an arithmetic that is not the one the window was solved with: the
 * builder is chosen from the same declarations the screen itself uses, in this module. A caller
 * free to pass its own rebuild could resample a different engine and report the result as this
 * screen's resolution.
 */
export type GainResolutionScreen =
  | { readonly kind: 'stability'; readonly weights: FamilyScreenWeights; readonly shape: CvShape }
  | { readonly kind: 'onset'; readonly weights: FamilyScreenWeights; readonly shape: OnsetShape }
  | { readonly kind: 'family'; readonly weights: FamilyScreenWeights; readonly family: string };

/** What {@link gainResolution} needs: the dump, the window's answer, and which screen asked. */
/**
 * The dump, the weight under discussion, and which screen's arithmetic to rebuild with.
 *
 * The shared shape of both ensembles: they draw from the SAME discarded digits, with the same seed and
 * the same trial count, but read different outputs from them — how many of the window's gains survive,
 * and where the window's own cap lands.
 */
export interface ResolutionInput {
  readonly cases: readonly DiagnosedCase[];
  /**
   * The weight under discussion.
   *
   * For {@link gainResolution} it is the weight being recommended; for {@link capResolution} it is the
   * weight whose position AGAINST the cap is being read, which is the same number whenever a window
   * recommends one.
   */
  readonly ship: number;
  readonly screen: GainResolutionScreen;
  readonly trials?: number;
  /**
   * How many more digits every rendered field is imagined to carry; `0` (the default) is the box the
   * artifact actually has.
   *
   * Not a knob for tuning a number: it is the SCALE `refinementFrontier` sweeps, and reading an
   * ensemble drawn at `k > 0` as a statement about the dump would be reading a hypothetical. The
   * result carries the value back out, so a printed line can never describe a refined ensemble as the
   * artifact's own.
   */
  readonly extraDigits?: number;
}

export interface GainResolutionInput extends ResolutionInput {
  /** The window's own `gained` — the cases the weight is being recommended FOR. */
  readonly gained: readonly string[];
}

/**
 * How many of a window's gains survive the digits its inputs were printed with.
 *
 * The count a screen reports is arithmetic on numbers the dump ROUNDED, and the screen never said
 * so. Measured on the shipped dump of run `35107871516`: the decisive-stability screen reported
 * `gain 6` at `0.030170`; the run dispatched at that weight delivered FIVE, and the case it did not
 * collect held a lead of `1.054e-4` — a fifth of the `5.0e-4` the formatter had already thrown
 * away. The count was never resolvable from the artifact, and this reports the range and the
 * distribution it IS resolvable to.
 *
 * The screen's own builder is used, so each screen resamples its OWN scoring: a resampling that
 * re-derived the base would be measuring a different engine than the window it qualifies.
 *
 * The set of cases under test is the window's own `gained`. A perturbation can in principle satisfy
 * a case the unperturbed solve did not name, but a weight is only ever recommended for the gains
 * that were MEASURED, so the question "does this weight deliver these k" is the one that decides.
 *
 * @param input - The dump, the window's gains, the weight it recommends, and which screen asked.
 * @returns The histogram, its bounds, and which gains hold in every trial.
 */
export function gainResolution(input: GainResolutionInput): GainResolution {
  const rebuild = rebuildFor(input.screen);
  // ONE box per ensemble, built from the screen, the ARTIFACT's own declared precision and the refinement
  // together — so the quanta, the columns and the precision cannot come from three different answers to
  // "what does this screen read, and how finely was it printed".
  const box = resolutionBoxFor(input.screen, dumpPrecisionOf(input.cases), input.extraDigits);
  const trials = input.trials ?? GAIN_RESOLUTION_TRIALS;
  const byPack = new Map(input.cases.map((kase) => [kase.datapack, kase]));
  // `Array.from`, not `new Array(n).fill(0)`: the length form of the constructor is ambiguous with
  // the single-element form, and a count per possible gain is a LENGTH here.
  const histogram = Array.from({ length: input.gained.length + 1 }, () => 0);
  const held = Array.from({ length: input.gained.length }, () => 0);
  // Both lookups are ASSERTED rather than guarded, because both invariants are structural: every
  // named gain comes from the same solve as `cases`, and a gained case has a ground truth, so its
  // rebuild is defined. A `?? 0` or a `return` here could never fire, and if it did it would report
  // an unknown datapack as a LOSS — the one failure this instrument cannot afford, because the
  // number it produces is a recommendation.
  const drawn = input.gained.map((datapack) => byPack.get(datapack)!);
  // The whole `gained` list is drawn for EVERY trial, in list order, so the sequence a gain
  // receives does not depend on how many of its neighbours held — a shared draw would make one
  // gain's survival a function of another's, which is not a property of the dump.
  const next = seededUnit(GAIN_RESOLUTION_SEED);
  for (let trial = 0; trial < trials; trial++) {
    let count = 0;
    drawn.forEach((kase, index) => {
      const built = rebuild(jitterCase(kase, next, box))!;
      if (intervalsCover(caseWeightInterval(built), input.ship)) {
        count++;
        held[index] = held[index]! + 1;
      }
    });
    histogram[count] = histogram[count]! + 1;
  }
  const seen = histogram
    .map((count, index) => ({ count, index }))
    .filter((entry) => entry.count > 0)
    .map((entry) => entry.index);
  return {
    trials,
    box,
    histogram,
    least: Math.min(...seen),
    most: Math.max(...seen),
    resolved: input.gained.filter((_, index) => held[index] === trials),
    held,
  };
}

/**
 * The scoring one screen's window was solved with, as a function of a (possibly jittered) case.
 *
 * @param screen - Which screen's arithmetic to rebuild with.
 * @returns The builder, or one that reports every case as absent for a family the dump does not
 *   carry — which the screen itself would have reported as a zero row.
 */
function rebuildFor(
  screen: GainResolutionScreen,
): (kase: DiagnosedCase) => WeightSeparationCase | undefined {
  if (screen.kind === 'stability') {
    return (kase) => stabilityCase(kase, screen.weights, screen.shape);
  }
  if (screen.kind === 'onset') {
    return (kase) => onsetCase(kase, screen.weights, screen.shape);
  }
  const { weights, family } = screen;
  return (kase) => buildFamilyCases([kase], weights, family)[0];
}

/**
 * Where the window's own CAP lands once the dump's discarded digits are drawn.
 *
 * The second of the two channels {@link UnrepresentableFrontier.lossFloor} does NOT model. That floor
 * says how far the ENGINE may go below a cap the model reads off the printed numbers; this says how
 * much that cap is itself a function of which numbers were printed — the base is reconstructed from
 * `selfAnomaly`, `logScore` and `latRise` at three decimals, and the cap is a MINIMUM over the cases
 * the base gets right, so a draw that closes one lead moves it.
 *
 * The count that matters is {@link belowShip}: the draws in which the cap lands UNDER the weight the
 * window recommends. Those are the draws in which the recommendation's own premise — "no satisfied case
 * is lost at this weight" — is not what the artifact says, and a screen that printed only `cap 0.030480`
 * could not tell whether that happened once or never.
 */
export interface CapResolution {
  /** Resamplings drawn. */
  readonly trials: number;
  /** The box these draws came from; see {@link GainResolution.box}. */
  readonly box: ResolutionBox;
  /** The cap each draw produced, in draw order. */
  readonly caps: readonly number[];
  /** The smallest cap any draw produced. */
  readonly least: number;
  /** The largest. */
  readonly most: number;
  /** Draws whose cap fell strictly BELOW `ship`. */
  readonly belowShip: number;
  /**
   * Draws in which the window actually LOSES a case at `ship` — the unbiased reading.
   *
   * {@link belowShip} cannot be read on its own, and the reason is structural: the cap is a MINIMUM
   * over every satisfied case, and the minimum of many noisy quantities sits below the minimum of their
   * centres. So `belowShip` reports the extremal draw of a hundred, not the typical one, and on a dump
   * with hundreds of competing cases it can read `100 of 100` about a window that loses nothing. This
   * field asks the question the recommendation is actually about — "at the weight being shipped, does
   * any case the window protects get lost?" — which no minimum can bias.
   */
  readonly lostAtShip: number;
  /**
   * The most protected cases any single draw lost — the SEVERITY to pair with {@link lostAtShip}'s
   * frequency.
   *
   * `lostAtShip` is an OR over the window's cases, so it too is an extreme-value reading: it rises with
   * how many cases the window protects, even when each one is individually unlikely to move. Without a
   * severity beside it, `99 of 100` cannot be told apart from "one case on the boundary moved in almost
   * every draw" — and those two call for opposite decisions.
   */
  readonly worstLost: number;
}

/**
 * Draw the discarded digits and re-solve the window's cap, once per draw.
 *
 * Every case is drawn, in `cases` order, and the window is re-solved with the SAME solver the
 * recommendation came from — not by tracking the one case that set the cap, because the draw decides
 * WHICH case that is: a jittered case can become the new minimum, or stop being satisfied at zero
 * altogether, and a shortcut that assumed otherwise would report the cap of a window nobody solved.
 *
 * @param input - The dump, the weight to compare against, and which screen asked.
 * @returns The caps, their bounds, and how many draws put the cap below `ship`.
 */
export function capResolution(input: ResolutionInput): CapResolution {
  const rebuild = rebuildFor(input.screen);
  const box = resolutionBoxFor(input.screen, dumpPrecisionOf(input.cases), input.extraDigits);
  const trials = input.trials ?? CAP_RESOLUTION_TRIALS;
  const next = seededUnit(GAIN_RESOLUTION_SEED);
  const caps: number[] = [];
  let belowShip = 0;
  let lostAtShip = 0;
  let worstLost = 0;
  for (let trial = 0; trial < trials; trial++) {
    const drawn = input.cases.map((kase) => rebuild(jitterCase(kase, next, box)));
    const built = drawn.filter((one): one is WeightSeparationCase => one !== undefined);
    const cap = computeZeroRegressionWindow(built).cap;
    caps.push(cap);
    if (cap < input.ship) belowShip++;
    // The unbiased reading, from the SAME drawn window: the two helpers each derive their own intervals
    // from `built`, which is the cost of not re-implementing either of them here.
    const lost = zeroRegressionSamples(built, [input.ship])[0]!.lost;
    if (lost > 0) lostAtShip++;
    if (lost > worstLost) worstLost = lost;
  }
  return {
    trials,
    box,
    caps,
    least: Math.min(...caps),
    most: Math.max(...caps),
    belowShip,
    lostAtShip,
    worstLost,
  };
}

/**
 * Render {@link capResolution} as one line.
 *
 * Printed beside the cap it qualifies, and it names the count that decides rather than the range alone:
 * `[0.0031, 0.0412]` reads as a curiosity, while `12 of 100 draws put the cap below the weight being
 * recommended` is a verdict on the recommendation.
 *
 * @param resolution - The ensemble.
 * @param ship - The weight being recommended.
 * @returns One line, without a leading space.
 */
export function formatCapResolutionLine(resolution: CapResolution, ship: number): string {
  const at = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : 'unbounded');
  const intact = resolution.trials - resolution.lostAtShip;
  // Both readings are extreme values of the same ensemble (a MINIMUM over the cases for the cap, an OR
  // over them for the loss) so both are printed WITH what makes them readable: the cap with the reason
  // its range sits low, the loss with its frequency AND its severity. A verdict is in the last clause,
  // and it is about the sentence above — `lost at ship 0` — not about the window being wrong.
  const tail =
    resolution.lostAtShip === 0
      ? ` — the recommendation survives the digits its inputs were printed with`
      : ` — so \`lost at ship 0\` above holds for the PRINTED digits, not for the box they stand for`;
  return (
    `  cap resolution: over ${resolution.trials} draws of the discarded digits ` +
    `(${drawnResolutionClause(resolution.box)}) the cap lands in ` +
    `[${at(resolution.least)}, ${at(resolution.most)}] (a minimum over every satisfied case, so the ` +
    `range sits low); at the shipped ${at(ship)} the window stays intact in ${intact} of the ` +
    `${resolution.trials} draws, losing at most ${resolution.worstLost}` +
    tail
  );
}

/**
 * Render {@link gainResolution} as one line.
 *
 * The scale is printed in the same units as the margins it qualifies, and the distribution is
 * printed rather than only its bounds: `gain 6` under a dump that puts 30% of its mass on six and
 * 44% on five means something a reader can act on, while `[3, 6]` would not distinguish it from a
 * claim with no interior at all.
 *
 * @param resolution - The ensemble.
 * @returns One line, or an empty string when there was nothing to resolve — a distribution over no
 *   gain is not a measurement, and printing an empty histogram would read like one.
 */
export function formatResolutionLine(resolution: GainResolution): string {
  const gains = resolution.held.length;
  if (gains === 0) return '';
  const entries = resolution.histogram
    .map((count, index) => ({ count, index }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.index - a.index)
    .map((entry) => `${entry.index} in ${((100 * entry.count) / resolution.trials).toFixed(1)}%`);
  const verdict =
    resolution.resolved.length === gains
      ? `every one of the ${gains} gains holds in all ${resolution.trials} resamplings`
      : `${resolution.resolved.length} of ${gains} gains hold in every one`;
  return (
    `  resolution: ${drawnResolutionClause(resolution.box)}; ${resolution.trials} resamplings ` +
    `of that draw give ${entries.join(', ')} — ${verdict}`
  );
}

/**
 * The resolution an ensemble actually drew IN, as a clause naming each column and its own quantum.
 *
 * ONE owner, because two reports print it and the sentence is the one place a reader is told what a
 * margin is measured against. It used to be a single hard-coded `the dump renders 3 decimals, so a
 * lead between two services is only good to ±1.0e-3` — true of the base fields and of the decisive
 * `cv`, and false of the onset delay, which the renderer prints in WHOLE MILLISECONDS: three orders of
 * magnitude away, and on the screen whose only input it is.
 *
 * Each column is named as the screen READS it rather than as the dump spells it, so a reader cannot
 * take one quantum for another — and every quantum here comes off the BOX the draws came from, including
 * the artifact's own declared precision. The version before that read a module constant quoted the right
 * number only for a dump rendered at the producer's current default.
 *
 * @param box - The box the ensemble drew from; see {@link resolutionBoxFor}.
 * @returns The clause, without a leading space.
 */
function drawnResolutionClause(box: ResolutionBox): string {
  const { decimals, stated } = box.precision;
  // A reader has to be able to tell a precision the ARTIFACT declared from one the reader SUPPLIED: an
  // archived dump carries no precision field, and a sentence printed the same way for both would let an
  // inference pass as a measurement. The quantum is read off the box the draws came from — never off a
  // constant, which is the wrong owner one step later and was modelling a different artifact entirely.
  const bar = (2 * box.service).toExponential(1);
  const base = stated
    ? `the dump states ${decimals} decimals, so a gap between two services is only good to ±${bar}`
    : `the dump does not state its precision — read as the ${decimals} used before the header carried ` +
      `it, so a gap between two services is only good to ±${bar}`;
  const columns = [
    box.fields.cv ? `the decisive cv (±${bar})` : undefined,
    box.fields.onset
      ? `the onset delay in whole milliseconds (±${(2 * box.onset).toFixed(1)} ms)`
      : undefined,
  ].filter((one) => one !== undefined);
  const body =
    columns.length === 0
      ? base
      : `${base}, and this term's own column is drawn with it: ${columns.join(' and ')}`;
  // A REFINED box is a hypothetical rather than a measurement, so the sentence has to say so: the frontier's
  // intermediate ensembles go through this clause too.
  return box.extraDigits === 0 ? body : `${body} (at ${box.extraDigits} digits beyond that)`;
}

/**
 * Render {@link computeZeroRegressionWindow} as a report.
 *
 * The cap is inserted into the grid, plus one weight just above it, so the claim is
 * two-sided: nothing is lost up to the cap, and the case named as the binder is
 * lost immediately after it. A report that only probed the grid could state a cap
 * it never demonstrated.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @param slope - Which term's score is the coefficient.
 * @param latFloor - Rise a service must clear for the latency term to credit it, when
 *   `slope` is `lat`. This models a term SHAPE the engine does not have yet, so a
 *   report that names it is a prediction rather than a measurement — the default is
 *   the shipped shape and says so in the header.
 * @param grid - Weights to probe; defaults to {@link DEFAULT_WINDOW_GRID}.
 * @returns A multi-line report, without a trailing newline.
 */
export function formatZeroRegressionWindowReport(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
  slope: SlopeKind = 'failedEdge',
  latFloor = 1,
  grid: readonly number[] = DEFAULT_WINDOW_GRID,
): string {
  const built = buildWeightSeparationCases(cases, weights, slope, latFloor);
  const window = computeZeroRegressionWindow(built);
  // A relative step, so the probe lands just outside the cap whatever its scale.
  // It must clear the SAME epsilon the interval test inflates by: `Number.EPSILON`
  // alone is smaller than `WEIGHT_EPSILON`, so for a cap of ZERO — a case held only
  // by a tie — the probe landed back inside the window and the "first weight above
  // the cap" row showed the case still standing, which reads as the cap being wrong.
  const justAbove = Number.isFinite(window.cap)
    ? window.cap * (1 + 1e-6) + WEIGHT_EPSILON * 2
    : Number.POSITIVE_INFINITY;
  const probes = Number.isFinite(justAbove) ? [...grid, window.cap, justAbove] : [...grid];
  const samples = zeroRegressionSamples(built, probes);

  // Six decimals, not three. The cap is the number a flip decision is made
  // against, and the shipped latency weight (0.03) sits 1.5% below it: at three
  // decimals both render as `0.030`, so a reader could not tell how much room the
  // shipped point has, nor separate the cap from a grid point beside it.
  const cap = Number.isFinite(window.cap) ? window.cap.toFixed(6) : 'unbounded';
  const lines: string[] = [];
  lines.push(
    `Weight window (slope=${slope}${latFloor > 1 ? `, latFloor=${latFloor}` : ''}; ` +
      `logWeight=${weights.logWeight}; no case correct today may become incorrect):`,
  );
  lines.push(
    `  cases: ${window.cases}   correct at 0: ${window.satisfied}   ` +
      `unreachable at every weight: ${unreachableClause(window)}`,
  );
  lines.push(
    window.capBinder === undefined
      ? `  cap weight: ${cap}   no case can be overtaken at any weight`
      : `  cap weight: ${cap}   binder ${window.capBinder.datapack}`,
  );
  if (window.capBinder !== undefined) {
    // The cap's own arithmetic, so a reader can see what a reshaping of the term
    // would have to change. A target slope of 0 against a rival slope of 1 is the
    // maximal gap: no pointwise reshaping can widen that case's window.
    const b = window.capBinder;
    lines.push(
      `  cap detail: ${b.rival} overtakes ${b.target} — lead ${b.lead.toFixed(6)} / ` +
        `slope gap ${b.slopeGap.toFixed(6)} (slopes ${b.targetSlope.toFixed(6)} -> ` +
        `${b.rivalSlope.toFixed(6)})`,
    );
  }
  lines.push(
    `  gains reachable inside the window: ${window.gains.length}` +
      (window.gains.length === 0 ? '' : ` (${window.gains.map((g) => g.datapack).join(', ')})`),
  );
  lines.push(
    `  ${'w'.padEnd(12)}${'correct'.padStart(8)}${'gained'.padStart(8)}${'lost'.padStart(6)}`,
  );
  for (const sample of samples) {
    const mark = sample.weight === justAbove ? '   <- first weight above the cap' : '';
    lines.push(
      `  ${sample.weight.toFixed(6).padEnd(12)}${String(sample.correct).padStart(8)}` +
        `${String(sample.gained).padStart(8)}${String(sample.lost).padStart(6)}${mark}`,
    );
  }
  return lines.join('\n');
}

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
/**
 * The command line of `analyze-fse26-diagnose`, as data.
 *
 * It lives here, beside the functions it configures, rather than in the entry
 * point, for one reason: the entry point calls `main()` at import time, so a test
 * cannot load it, so its flags were unmeasured. That is how the defect below got
 * in, and it is why the parser is now a pure function that returns an option
 * object instead of reading `process.argv`.
 *
 * The defect, concretely. The run's LOG weight was accepted on FOUR flags — on
 * `--log-weight` and on each of `--misses`, `--weight-sweep` and `--window`. Two
 * invocations of this tool that differ only in which flag got the number:
 *
 *   --dump d --window 1        --slope lat --lat-floor 10.3   -> correct at 0: 673
 *   --dump d --window 0.561495 --slope lat --lat-floor 10.3   -> correct at 0: 669
 *
 * The second passed the shipped LATENCY weight where a LOG weight belongs, and it
 * printed a self-consistent report whose baseline and (more importantly) whose cap
 * were wrong. The cap is the number the register quotes and a flip is decided
 * against, so a tool that accepts the wrong weight in that slot is a tool that
 * corrupts the record while looking like it is checking it.
 *
 * The repair is structural: the weight has ONE owner, the three sections are
 * switches, and a number where a switch is expected is an error that names
 * `--log-weight` — because the old form is in shell histories and a bare
 * "unrecognised argument" would send a reader looking for a flag that moved.
 *
 * @module benchmarks/fse26-diagnose-analyze
 */

/** Where the two modes of the command line are declared. */
export type AnalyzeOptions = AnalyzeComparisonOptions | AnalyzeDumpOptions;

export interface AnalyzeComparisonOptions {
  readonly kind: 'comparison';
  readonly before: string;
  readonly after: string;
  readonly output: string | undefined;
}

/** The sections that reconstruct a score from the dump. */
export type AnalyzeSectionKind =
  | 'misses'
  | 'weightSweep'
  | 'window'
  | 'termOracle'
  | 'familyScreen'
  | 'onsetScreen'
  | 'discriminator'
  | 'guardCensus'
  | 'cvScreen'
  | 'separatorScreen';

/**
 * The sections that reconstruct a SCORE, and therefore need the weight it ran at.
 *
 * Named as data because the guard and its own error message disagreed: the message
 * listed four sections and the code required the weight of all of them, so a section
 * that reads only the engine's rendered inventories had to be given a number nothing
 * used. A guard that is broader than its stated reason teaches a reader to pass a
 * meaningless flag.
 */
const SCORE_RECONSTRUCTING_SECTIONS: Readonly<Set<AnalyzeSectionKind>> =
  new Set<AnalyzeSectionKind>([
    'misses',
    'weightSweep',
    'window',
    'termOracle',
    'familyScreen',
    'onsetScreen',
    'discriminator',
    // Reconstructs `shippedScores` as the base it measures a distance from, so it needs the
    // weight that rebuilds the ranking the run actually had.
    'cvScreen',
  ]);

/**
 * One requested section, CARRYING the weight it is computed at.
 *
 * The pairing is the whole point. A section cannot be requested without a weight
 * because there is no way to write one down without the other, so "which weight
 * did this section use" — the question that produced a wrong cap — has exactly
 * one answer per section and it is on the section. Canonical order, which
 * {@link formatAnalyzeSections} prints in: window, weightSweep, misses.
 */
export interface AnalyzeSection {
  readonly kind: AnalyzeSectionKind;
  /**
   * The weight the run used on its log term — the ONLY owner of that number.
   *
   * Never defaulted: the dump's order is only self-consistent with the weight its
   * own run used, so a section computed at a guessed weight reports real cases as
   * `unexplained` and reads as a measurement.
   */
  readonly logWeight: number;
  /**
   * The run's per-edge latency weight and rise floor — the shape the section
   * describes.
   *
   * On the section rather than in the section's options for the same reason as the
   * log weight, and it is not hypothetical: the miss attribution and the window
   * both read a floor, and while it lived in one place and was read in two, the
   * attribution could describe a shape the window did not. The DEFAULTS are the
   * shipped constants, so a reader diagnosing the shipped engine gets the shipped
   * engine and an ablation has to be written down.
   */
  readonly latWeight: number;
  readonly latFloor: number;
  /**
   * The run's pool-dominance penalty. On the section for the third time and the same
   * reason: the attribution's `unexplained` count is a claim about the modelled terms,
   * so a section computed at the wrong penalty reports the shipped term's own decisions
   * as engine anomalies — which is exactly how the missing latency term produced twelve
   * phantom defects.
   */
  readonly poolWeight: number;
  /**
   * The run's temporal pair — the fifth shipped term, and here for the fourth time and the
   * same reason.
   *
   * The shape is on the section rather than defaulted at the point of use because a weight
   * without it is not a configuration: the shipped weight is measured on exactly one shape,
   * and a report that reconstructed the other one while printing the weight would be
   * describing an engine nobody has run.
   */
  readonly temporalWeight: number;
  readonly onsetShape: OnsetShape;
  /**
   * A weight to READ the case set at, alongside the weight the window would solve for.
   *
   * The window answers "which weight is best here"; a re-opening condition asks "is candidate W
   * neutral here", and that question used to be answerable only by buying a run — which states it as
   * cells moved rather than as cases gained and lost. `undefined` (never 0) when nobody named one,
   * so the default report is the one it was before this flag existed.
   */
  readonly atWeight?: number;
}

export interface AnalyzeDumpOptions {
  readonly kind: 'dump';
  readonly dump: string;
  readonly family: MetricFamily | undefined;
  /** The sections to print, in canonical order; empty when none was requested. */
  readonly sections: readonly AnalyzeSection[];
  readonly slope: SlopeKind;
  readonly output: string | undefined;
}

/** Canonical section order, which is also the order the report prints them in. */
export const ANALYZE_SECTION_ORDER: readonly AnalyzeSectionKind[] = [
  'window',
  'weightSweep',
  'termOracle',
  'familyScreen',
  'onsetScreen',
  'discriminator',
  'cvScreen',
  'separatorScreen',
  'guardCensus',
  'misses',
];

/**
 * The dominance thresholds the log-mode pre-screen sweeps.
 *
 * Data rather than a literal inside the renderer so the frontier a report shows is
 * the grid that was asked for. The threshold itself is NOT restated here: it comes
 * from the engine's `DEFAULT_HTTP_DOMINANCE_THRESHOLD`, and the grid brackets it.
 * The grid is coarse on purpose — the mode's frontier is a STEP, and a fine grid
 * would print a plateau twenty times and hide that it is one step.
 */
export const DEFAULT_TERM_ORACLE_DOMINANCE_GRID: readonly number[] = [
  0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 0.95,
];

/**
 * The usage line names every flag the parser accepts, the pool penalty included: a
 * reader who does not know it exists reads a shipped-configuration report as a
 * three-term one, which is the reading this whole module exists to prevent.
 */
const ANALYZE_USAGE =
  'usage: analyze-fse26-diagnose --before <dump> --after <dump> | ' +
  '--dump <dump> [--log-weight <w>] [--lat-weight <w>] [--lat-floor <rise>] ' +
  '[--pool-penalty <w>] [--temporal-weight <w>] [--onset-shape <shape>] ' +
  '[--misses] [--weight-sweep] [--window] [--term-oracle] [--family-screen] ' +
  '[--onset-screen] [--discriminator] [--cv-screen] [--separator-screen] ' +
  '[--guard-census] ' +
  '[--at-weight <w>] [--family <regex>] ' +
  '[--family-label <name>] [--slope failedEdge|lat] [--output <file>]';

/**
 * Flags that take a value.
 *
 * Naming them explicitly — rather than treating every `--flag` as a key and the
 * next token as its value — is what lets a number after a SWITCH be recognised as
 * the mistake it is. A permissive parser reads `--window 0.561495` as a section at
 * the weight 0.561495, which is precisely how the wrong cap was produced.
 */
const VALUE_FLAGS = new Set([
  'dump',
  'before',
  'after',
  'family',
  'family-label',
  'lat-floor',
  'lat-weight',
  'log-weight',
  'onset-shape',
  'output',
  'pool-penalty',
  'slope',
  'temporal-weight',
  'at-weight',
]);

/** Flags that take no value. */
const SWITCH_FLAGS = new Set([
  'misses',
  'weight-sweep',
  'window',
  'term-oracle',
  'family-screen',
  'onset-screen',
  'discriminator',
  'cv-screen',
  'separator-screen',
  'guard-census',
]);

/**
 * Parse the analyzer's command line.
 *
 * @param argv - Arguments WITHOUT the interpreter and script path.
 * @returns The parsed options.
 * @throws When a value is unusable, a section is requested without the log weight
 *   it has to reconstruct at, or the line names neither mode. Every one of these
 *   is a hard failure: the alternative is a report that looks like a measurement.
 */
export function parseAnalyzeArgs(argv: readonly string[]): AnalyzeOptions {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (SWITCH_FLAGS.has(token.replace(/^--/, ''))) {
      switches.add(token.replace(/^--/, ''));
      continue;
    }
    const name = token.startsWith('--') ? token.slice(2) : undefined;
    if (name === undefined || !VALUE_FLAGS.has(name)) {
      throw new Error(unrecognised(token, argv[i - 1]) + '\n' + ANALYZE_USAGE);
    }
    if (i + 1 >= argv.length) throw new Error(`--${name} expects a value\n${ANALYZE_USAGE}`);
    values.set(name, argv[++i]!);
  }

  const output = values.get('output');
  const before = values.get('before');
  const after = values.get('after');
  if (before !== undefined && after !== undefined) {
    return { kind: 'comparison', before, after, output };
  }

  const dump = values.get('dump');
  if (dump === undefined) throw new Error(ANALYZE_USAGE);

  // Kebab to camel, in one place: a switch whose name does not map to its section
  // kind is silently never rendered, which is how a flag can be accepted and ignored.
  const requested = new Set<string>(
    [...switches].map((name) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())),
  );
  const rawWeight = values.get('log-weight');
  const needsWeight = [...requested].some((kind) =>
    SCORE_RECONSTRUCTING_SECTIONS.has(kind as AnalyzeSectionKind),
  );
  if (needsWeight && rawWeight === undefined) {
    // Names the flags, states which weight it is, and gives the shipped value, so
    // the reader does not have to guess between the four weights this tool knows.
    // Fires only for the sections that actually reconstruct a score: requiring it of
    // a section that reads the engine's own rendered inventories asks for a number
    // the report never uses, which is how a flag becomes ritual.
    throw new Error(
      '--misses/--weight-sweep/--window/--term-oracle/--family-screen/--onset-screen/' +
        '--discriminator reconstruct a score, so they need ' +
        "the weight that score ran at: pass --log-weight <w>, the run's LOG weight (the " +
        `coefficient on logScore; the shipped runs use 1).\n${ANALYZE_USAGE}`,
    );
  }
  let logWeight = 0;
  if (rawWeight !== undefined) {
    // STRICT, with no fallback: the flag is REQUIRED by any section, so a typo would
    // otherwise leave the reader with a report at whatever weight the fallback named
    // — numbers the run did not produce.
    const parsed = Number(rawWeight);
    if (rawWeight.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`--log-weight expects a non-negative finite number, got '${rawWeight}'`);
    }
    logWeight = parsed;
  }

  // Both defaults are the SHIPPED constants, imported: a diagnostic describes an
  // engine, and a defaulted-to-something-else reader describes an engine that does
  // not exist. `--lat-weight 0` and `--lat-floor 1` are the explicit ablations.
  const latWeight = numberFlag(
    values.get('lat-weight'),
    '--lat-weight',
    DEFAULT_LAT_WEIGHT,
    (n) => n >= 0,
  );
  const poolWeight = numberFlag(
    values.get('pool-penalty'),
    '--pool-penalty',
    DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    // A negative weight would CREDIT the pool-dominant service, which is a different
    // signal than the one measured and not one anybody has evidence for.
    (n) => n >= 0,
  );
  const latFloor = numberFlag(
    values.get('lat-floor'),
    '--lat-floor',
    DEFAULT_LAT_MIN_RISE,
    // Below 1 is refused rather than accepted as a no-op: magnitudes are
    // `log1p(max(0, rise - 1))`, so such a floor masks nothing, and accepting it
    // would render a configuration the operator believes changed something.
    (n) => n >= 1,
  );
  const temporalWeight = numberFlag(
    values.get('temporal-weight'),
    '--temporal-weight',
    DEFAULT_TEMPORAL_WEIGHT,
    (n) => n >= 0,
  );
  // Strict, falling back to the SHIPPED shape: a reader that names a shape the engine
  // does not implement must get the configuration that was measured rather than a term
  // invented at the command line.
  const rawShape = values.get('onset-shape');
  const onsetShape: OnsetShape =
    rawShape !== undefined && isOnsetShape(rawShape) ? rawShape : DEFAULT_ONSET_SHAPE;

  // A named weight, for the screens that can read one. STRICT like the log weight, and refused
  // unless a screen that PRINTS it was also requested: a flag accepted and rendered nowhere is how
  // a flag becomes ritual, which is the rule this file already applies to `--log-weight`.
  const rawAt = values.get('at-weight');
  let atWeight: number | undefined;
  if (rawAt !== undefined) {
    const parsed = Number(rawAt);
    if (rawAt.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`--at-weight expects a non-negative finite number, got '${rawAt}'`);
    }
    if (!requested.has('cvScreen') && !requested.has('onsetScreen')) {
      throw new Error(
        '--at-weight reads a case set at ONE named weight, which only the screens that solve a ' +
          'window can render: pass --cv-screen or --onset-screen as well. On its own it would be ' +
          'accepted and printed nowhere.\n' +
          ANALYZE_USAGE,
      );
    }
    atWeight = parsed;
  }

  const family = values.get('family');

  return {
    kind: 'dump',
    dump,
    // An invalid pattern is a loud failure, never a report whose family silently
    // matches nothing.
    family:
      family === undefined
        ? undefined
        : { label: values.get('family-label') ?? family, pattern: new RegExp(family) },
    sections: ANALYZE_SECTION_ORDER.filter((kind) => requested.has(kind)).map((kind) => ({
      kind,
      logWeight,
      latWeight,
      latFloor,
      poolWeight,
      temporalWeight,
      onsetShape,
      atWeight,
    })),
    // Anything that is not exactly `lat` falls back to the term this solver was
    // built for, like every other switch here: a typo has to reproduce a known
    // configuration rather than invent one.
    slope: values.get('slope') === 'lat' ? 'lat' : 'failedEdge',
    output,
  };
}

/**
 * Read a numeric flag, or fall back to the SHIPPED value.
 *
 * Never to `0`: `0` is a *different measured configuration* for both of these, so a
 * typo would silently run an ablation and label it with the shipped configuration's
 * name. The predicate states each flag's own domain — a latency weight may be 0 (the
 * term off) and a rise floor may not be below 1 (it would mask nothing).
 *
 * @param raw - The flag's value, or `undefined` when absent.
 * @param flag - The flag's spelling, for the error.
 * @param fallback - The shipped value.
 * @param usable - Whether the parsed number is in the flag's domain.
 * @returns The parsed value or the fallback.
 * @throws When the value is present and unusable, because the fallback would then
 *   describe a configuration nobody asked for while the report looked measured.
 */
function numberFlag(
  raw: string | undefined,
  flag: string,
  fallback: number,
  usable: (value: number) => boolean,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(parsed) || !usable(parsed)) {
    throw new Error(`${flag} expects a usable number, got '${raw}'`);
  }
  return parsed;
}

/**
 * Explain an unusable token, recognising the one mistake this parser exists for.
 *
 * @param token - The offending token.
 * @param previous - The token before it, which is a switch when the mistake is the
 *   pre-`--log-weight` form `--window <w>`.
 * @returns The message, without the usage block.
 */
function unrecognised(token: string, previous: string | undefined): string {
  const prev = previous?.replace(/^--/, '');
  const numeric = token !== '' && Number.isFinite(Number(token));
  if (prev !== undefined && SWITCH_FLAGS.has(prev) && numeric) {
    return (
      `--${prev} is a switch and takes no value, so '${token}' has nowhere to go. ` +
      "The run's LOG weight — not a signal weight such as latWeight — belongs on " +
      '--log-weight.'
    );
  }
  return `unrecognised argument '${token}'`;
}

/**
 * Render the report for one dump, in the canonical section order.
 *
 * Extracted from the entry point for the same reason the parser was: the entry
 * point calls `main()` at import time, so nothing here was measured. The ORDER is
 * part of the contract rather than an artefact of `unshift` calls: the sections
 * that answer a question about a candidate weight come first, then the metric
 * family, then the shape summary, which is the context for all of them.
 *
 * @param cases - Parsed dump.
 * @param dumpLabel - The path, echoed so a pasted report is traceable.
 * @param opts - The parsed options; `sections` is already in canonical order.
 * @returns The report text.
 */
export function formatAnalyzeSections(
  cases: readonly DiagnosedCase[],
  dumpLabel: string,
  opts: AnalyzeDumpOptions,
): string {
  const sections: string[] = [];
  if (opts.family !== undefined) {
    sections.push(formatMetricCompetitionReport(cases, opts.family, dumpLabel));
  }
  for (const section of opts.sections) {
    sections.push(analyzeSectionText(cases, section, opts, dumpLabel));
  }
  sections.push(formatAnomalyShapeReport(cases, dumpLabel));
  return sections.join('\n');
}

/**
 * Render one requested section, at the weight that section carries.
 *
 * A `switch` with no default: adding a section kind is a compile error until it is
 * rendered, which is the only way this stays exhaustive now that sections are data.
 *
 * @param cases - Parsed dump.
 * @param section - The section and the weight it is computed at.
 * @param opts - For the slope and the rise floor, which are properties of the
 *   shape rather than of the section.
 * @param dumpLabel - The dump's path, which only the section that echoes its own
 *   configuration into the report needs.
 * @returns The section text.
 */
function analyzeSectionText(
  cases: readonly DiagnosedCase[],
  section: AnalyzeSection,
  opts: AnalyzeDumpOptions,
  dumpLabel: string,
): string {
  switch (section.kind) {
    case 'window':
      return formatZeroRegressionWindowReport(
        cases,
        { logWeight: section.logWeight },
        opts.slope,
        section.latFloor,
      );
    case 'weightSweep':
      return formatWeightSeparationReport(cases, { logWeight: section.logWeight }, opts.slope);
    case 'termOracle':
      // The dominance threshold is the ENGINE's constant, imported rather than
      // typed here, and the grid brackets it: a pre-screen read at a threshold the
      // engine does not have would describe a mode that cannot be run.
      return formatTermOracleReport(cases, dumpLabel, {
        logWeight: section.logWeight,
        latWeight: section.latWeight,
        latFloor: section.latFloor,
        dominance: DEFAULT_HTTP_DOMINANCE_THRESHOLD,
        dominanceGrid: DEFAULT_TERM_ORACLE_DOMINANCE_GRID,
        poolWeight: section.poolWeight,
        temporalWeight: section.temporalWeight,
        onsetShape: section.onsetShape,
      });
    case 'familyScreen': {
      // The screen solves against the shipped score, so it takes the whole configuration
      // from the section — the same owner as every other reconstruction here.
      // The section's own fields, all six. A hand-assembled subset is how the temporal
      // pair silently reverted to its shipped default the first time the flag was passed:
      // `undefined` reaches the `?? SHIPPED` inside and the report describes a
      // configuration the caller did not ask for while looking exactly like one they did.
      const weights: FamilyScreenWeights = section;
      return formatFamilyScreenReport(familyScreen(cases, weights), weights);
    }
    case 'onsetScreen': {
      // Same configuration object as the family screen, because it is the same
      // question over a different slope: is there a weight that gains a case without
      // losing one? The onset screen asks it of the only TIME in the dump.
      // The section's own fields, all six. A hand-assembled subset is how the temporal
      // pair silently reverted to its shipped default the first time the flag was passed:
      // `undefined` reaches the `?? SHIPPED` inside and the report describes a
      // configuration the caller did not ask for while looking exactly like one they did.
      const weights: FamilyScreenWeights = section;
      // The whole declared menu, so the axis cannot be left open on the technicality
      // that only one shape was tried.
      return formatOnsetMenuReport(onsetShapeMenu(cases, weights, section.atWeight), weights);
    }
    case 'discriminator': {
      // The screen fits and cross-validates its own rules, so it needs the whole
      // configuration as well — one owner, as everywhere else in this report.
      const options: TermOracleOptions = {
        logWeight: section.logWeight,
        latWeight: section.latWeight,
        latFloor: section.latFloor,
        dominance: DEFAULT_HTTP_DOMINANCE_THRESHOLD,
        dominanceGrid: DEFAULT_TERM_ORACLE_DOMINANCE_GRID,
        poolWeight: section.poolWeight,
        temporalWeight: section.temporalWeight,
        onsetShape: section.onsetShape,
      };
      return formatDiscriminatorReport(discriminatorScreen(caseOutcomes(cases, options)));
    }
    case 'cvScreen': {
      // The same configuration object as the family and onset screens, because it is the same
      // question over a different slope. The whole menu, so the axis cannot be left open on the
      // technicality that only one reading of the statistic was tried.
      const weights: FamilyScreenWeights = section;
      return formatCvMenuReport(cvShapeMenu(cases, weights, section.atWeight), weights);
    }
    case 'separatorScreen':
      // The run's own latency FLOOR, so the `lat` signal is the term the engine actually
      // scored rather than a credited-everything variant of it. No log weight: the section
      // reconstructs no score.
      return formatSeparatorCensus(
        separatorCensus(cases, DEFAULT_SEPARATOR_CRITERION, section.latFloor),
      );
    case 'guardCensus':
      // Reads the engine's own rendered inventories and the dump's own correct/wrong
      // outcome, so it takes no weights — none of the section's numbers came from this
      // report's reconstruction.
      return formatGuardCensus(guardCensus(cases));
    case 'misses':
      // The section's OWN fields, all six. Hand-assembling a subset here is how the
      // temporal pair silently reverted to its shipped default the first time this flag was
      // passed: `undefined` reaches the `?? SHIPPED` inside, and the report then describes
      // a configuration the caller did not ask for while looking exactly like one they did.
      return formatMissReport(cases, section);
  }
}
