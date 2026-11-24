/**
 * The free-investigation arm: a model given the raw telemetry and a query surface, instead of a table.
 *
 * ## Why this arm exists, and why it is not another reranker
 *
 * Every agentic arm this repository has measured handed the model a FIXED rendering of the case — a handful of
 * candidates and a feature column per candidate — and asked it to choose. Two 2026 papers price that shape, and
 * both price it last. `arXiv:2608.21310`'s ten-configuration table puts the pre-extracted-feature design
 * (`OpsAgent`) at **45.8 % Acc@1**, below every adaptive design in its top band (77.6–90.0 %), and names the
 * mechanism: a prescription decides where to look before the incident reveals what matters. `RCAtlas`'s 90-case
 * study reports the same ordering from the other side — harnesses that prescribe none of the model's calls read
 * **65–77 % PR@1** against **16–53 %** for five published, stage-prescribing agents.
 *
 * The capability this repository is missing is therefore not a better table and not a stronger model. It is a
 * model that can ASK. This module is that surface and nothing else: five retrieval tools over one case's own
 * telemetry, a terminal answer, a hard budget, and a parser that refuses anything its grammar does not admit.
 *
 * ## What it deliberately does not do
 *
 * It does not show the engine's ranking. The engine's order is the strongest prior in the repository (83.40 % at
 * `$0`), and seeding an investigation with it makes the arm a reranker of that order — the shape already measured
 * at chance ten times (`z = −9.26` on 5 335 claims). Seeding is a SEPARATE arm and is off here, so the free arm
 * means free.
 *
 * ## Two properties this module asserts rather than trusts
 *
 * * **A tool cannot invent evidence.** Every tool reads the case's own telemetry, and a service the case does not
 *   carry is refused BY NAME rather than answered with an empty list — an empty list would teach the model that a
 *   real service has no metrics.
 * * **A budget is a wall, not a hope.** Rounds, tool calls and transcript size are capped. `RCAtlas` publishes the
 *   reason: an investigation that stops asking is indistinguishable from one that cannot, and an unbounded loop
 *   spends the corpus's budget on one case.
 *
 * @module benchmarks/query-agent
 */

import type {
  BenchmarkCase,
  BenchmarkLogEntry,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import type { ChannelDeparture } from './channel-kind.js';
import { channelKindOf, conduitUnder, departureOf } from './channel-kind.js';
import type { ChatClient } from './chat-completions.js';

/** One metric's window summary, in the case's own units. */
export interface TelemetryMetric {
  /** The metric label as the producer wrote it. */
  readonly label: string;
  /** Median of the samples BEFORE the injection, or the first sample when none precede it. */
  readonly baseline: number;
  /** Largest sample AT or AFTER the injection. */
  readonly peak: number;
  /** `peak − baseline`, the quantity a rise test reads. */
  readonly delta: number;
  /** `peak / |baseline|` when the baseline is non-zero, else the peak itself. */
  readonly ratio: number;
  /**
   * The peak in units of the pre-window's OWN spread — `(peak − median) / max(1.4826 · MAD, |median| · 10⁻³)`.
   *
   * The ratio compares a rise to a LEVEL, so it rewards whatever was already large. This compares it to the series'
   * own fluctuation, which is the reading a candidate list needs when the metric families carry unrelated units.
   *
   * `undefined` in two cases, both of them a refusal rather than a default: a pre-window of fewer than three
   * samples cannot support a spread estimate, and a pre-window whose median is zero has no level to standardise
   * against. The second case is not hypothetical — 100 % of the arm's own 160 cases carry such a series (error
   * rates, class-loading counters) and an earlier version of this function, which floored the spread at `1e-9`,
   * reported **5e10** for them and let them occupy **88.5 %** of every fleet list. `bySurprise` orders an undefined
   * series last and falls back to the ratio, which is the statement the case actually supports.
   */
  readonly surprise?: number;
  /**
   * Smallest sample AT or AFTER the injection.
   *
   * Every other post-injection quantity here is built from {@link peak}, so a series that DROPPED was invisible to
   * the arm until iteration 323: its `delta` was negative and nothing read it, and `surprise` was negative and
   * nothing read that either. A victim of an upstream failure is exactly that shape — the work it was being sent
   * stopped arriving — so the field is the difference between reading *where a failure was observed* and reading
   * *who kept working*, which is what the 322 census said was missing.
   */
  readonly trough: number;
  /** `baseline − trough`, POSITIVE when the series fell below where the case started. */
  readonly fall: number;
  /**
   * The trough in units of the pre-window's own spread — `(median − trough) / spread`, the mirror of
   * {@link surprise} and computed from the same {@link dispersionOf}.
   *
   * The sign is kept rather than clamped at zero: a series that only rose reports a negative fall, and a rule that
   * reads `≥ κ` then refuses it without a second condition saying so.
   */
  readonly fallSurprise?: number;
  /** Milliseconds from the injection to the peak sample; negative when the peak precedes it. */
  readonly peakOffset: number;
}

/** Everything a tool may say about one service. */
export interface TelemetryService {
  readonly id: string;
  readonly metrics: readonly TelemetryMetric[];
  readonly callers: readonly string[];
  readonly callees: readonly string[];
  /** Milliseconds from the injection to the first `ERROR`/`FATAL` line at or after it, or `undefined`. */
  readonly firstErrorOffset: number | undefined;
  /** `ERROR`/`FATAL` lines at or after the injection. */
  readonly errorCount: number;
  /** Up to {@link LOG_LINES} of those lines, oldest first, already trimmed for a prompt. */
  readonly errorLines: readonly string[];
}

/** One failing interface, in the channel's own counts. */
export interface TelemetryFailedEdge {
  readonly caller: string;
  readonly callee: string;
  readonly failed: number;
  readonly baseline: number;
  /**
   * The part of {@link failed} whose request SHAPE the edge had never carried before the injection.
   *
   * `0` when the producer could not measure it, which is the pre-290 channel: absent instrument, no finding. The
   * field is carried into the tool view because it is the only count in the case that charges an END of the
   * interface — a callee that breaks rejects nothing, while a caller that corrupted its request sends a shape the
   * callee has never been asked for. Every other number on this edge is identical in the two situations.
   */
  readonly novel: number;
}

/** One edge's latency, before and after the injection. */
export interface TelemetryLatencyEdge {
  readonly caller: string;
  readonly callee: string;
  readonly pre: number;
  readonly post: number;
}

/** One case, as the tools see it. */
export interface Telemetry {
  readonly injectTime: number;
  readonly services: ReadonlyMap<string, TelemetryService>;
  readonly failed: readonly TelemetryFailedEdge[];
  readonly latency: readonly TelemetryLatencyEdge[];
}

/** How many log lines one `logs` call may print. */
export const LOG_LINES = 6;

/** How many metric families one `metric` call may print, largest rise first. */
export const METRIC_LINES = 6;

/** How many failing interfaces one `failed` call may print. */
export const FAILED_LINES = 6;

/** How many services one `fleet` call may print, largest rise first. */
export const FLEET_LINES = 8;

/** How many collapsing series a `fleet` or `metric` answer carries beside the rises. */
export const COLLAPSE_LINES = 2;

/** The longest message fragment a log line may contribute to a prompt. */
const MESSAGE_CHARS = 140;

/** The names a directive may use. One list, so the prompt and the dispatcher cannot disagree. */
export const QUERY_TOOLS = [
  'services',
  'fleet',
  'next',
  'metric',
  'logs',
  'edges',
  'failed',
  'answer',
] as const;

/** A directive's name. */
export type QueryTool = (typeof QUERY_TOOLS)[number];

/** One parsed directive. */
export type ParsedCall =
  | { readonly kind: 'tool'; readonly tool: QueryTool; readonly argument: string }
  | { readonly kind: 'unparsed'; readonly text: string };

/** Median of a numeric list, or `NaN` for an empty one. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * One series' window summary.
 *
 * @param label - The metric label.
 * @param timestamps - Sample times, milliseconds.
 * @param values - Sample values, aligned with `timestamps`.
 * @param injectTime - The injection, milliseconds.
 * @returns The summary.
 */
export function summariseSeries(
  label: string,
  timestamps: readonly number[],
  values: readonly number[],
  injectTime: number,
): TelemetryMetric {
  const pre: number[] = [];
  let peak = Number.NEGATIVE_INFINITY;
  let peakAt = injectTime;
  let trough = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const at = timestamps[index] ?? injectTime;
    if (at < injectTime) {
      pre.push(value);
      continue;
    }
    if (value > peak) {
      peak = value;
      peakAt = at;
    }
    if (value < trough) trough = value;
  }
  // A series that begins after the injection has no pre-window: its first sample is the only baseline the case
  // carries, and reading it is a statement about that case rather than a default invented here.
  const fallback = values.length > 0 ? values[0]! : 0;
  const baseline = pre.length > 0 ? median(pre) : fallback;
  const resolvedPeak = Number.isFinite(peak)
    ? peak
    : values.length > 0
      ? values[values.length - 1]!
      : 0;
  // The trough follows the same two fallbacks as the peak, so a series with no sample after the injection reads
  // "it never moved" rather than "it fell to negative infinity". One rule for both ends of the series.
  const resolvedTrough = Number.isFinite(trough)
    ? trough
    : values.length > 0
      ? values[values.length - 1]!
      : 0;
  const scale = Math.abs(baseline);
  const dispersion = dispersionOf(pre);
  return {
    label,
    baseline,
    peak: resolvedPeak,
    delta: resolvedPeak - baseline,
    ratio: scale > 0 ? resolvedPeak / scale : resolvedPeak,
    surprise: surpriseOf(pre, resolvedPeak),
    trough: resolvedTrough,
    fall: baseline - resolvedTrough,
    fallSurprise:
      dispersion === undefined ? undefined : (dispersion.mid - resolvedTrough) / dispersion.spread,
    peakOffset: peakAt - injectTime,
  };
}

/**
 * The peak in units of the pre-window's own dispersion.
 *
 * The estimator is the median and the MAD rather than the mean and the standard deviation, for the reason the
 * engine's own onset detector uses the same pair: a baseline window that contains one spike would otherwise inflate
 * its own spread and hide the fault it is measuring against.
 *
 * ## The zero level, and a claim this function had to withdraw
 *
 * A first version floored the spread at a thousandth of the level and let the level be zero, so the floor became
 * `1e-9` and a series that sat at zero and became 50 reported a surprise of **5e10**. A census over the arm's own
 * 160 cases then found that **100 %** of them carry such a series and that **88.5 %** of the fleet list's slots were
 * occupied by them — error rates and class-loading counters, which belong to VICTIMS rather than to sources. The
 * recall that ordering produced (76.9 % against the ratio's 63.1 %) was therefore not dispersion normalisation at
 * work; it was an error-rate sort wearing its name.
 *
 * A standardised reading needs a level to standardise against. When the pre-window's median is zero there is none,
 * and the honest answer is `undefined` — the ordering then falls back to the ratio, which is the observation the
 * case actually supports ("it was silent and then it was not"). Returning a fabricated infinity instead is how a
 * statistic comes to rank the blast radius above the source.
 *
 * @param pre - The samples before the injection, in time order.
 * @param peak - The largest sample at or after it.
 * @returns The surprise, or `undefined` when the pre-window cannot support an estimate.
 */
export function surpriseOf(pre: readonly number[], peak: number): number | undefined {
  const scale = dispersionOf(pre);
  return scale === undefined ? undefined : (peak - scale.mid) / scale.spread;
}

/**
 * The pre-window's level and its own spread, or `undefined` when the window cannot support either.
 *
 * Split out so that a rise and a fall are standardised by ONE definition rather than by two that agree today. The
 * fall needs the same denominator and the opposite numerator; two copies of this arithmetic would drift the moment
 * one of them learned something about zero medians or short windows, and the two readings would stop being
 * comparable — which is the only reason a threshold on one of them says anything about the other.
 *
 * @param pre - The samples before the injection, in time order.
 * @returns The median and the standardising spread, or `undefined` for fewer than three samples or a zero level.
 */
export function dispersionOf(pre: readonly number[]): { mid: number; spread: number } | undefined {
  if (pre.length < 3) return undefined;
  const mid = median(pre);
  // No level, no standardised reading. See the note above: this is the case that produced 5e10.
  if (mid === 0) return undefined;
  const mad = median(pre.map((value) => Math.abs(value - mid)));
  return { mid, spread: Math.max(1.4826 * mad, Math.abs(mid) * 1e-3) };
}

/** A log line, trimmed to a length a prompt can carry. */
function trimLine(entry: BenchmarkLogEntry): string {
  const message = entry.message.replace(/\s+/g, ' ').trim();
  return message.length > MESSAGE_CHARS ? `${message.slice(0, MESSAGE_CHARS)}…` : message;
}

/**
 * Build the tool view of one case.
 *
 * @param bench - The loaded case.
 * @returns The telemetry every tool reads.
 */
export function buildTelemetry(bench: BenchmarkCase): Telemetry {
  const callers = new Map<string, string[]>();
  const callees = new Map<string, string[]>();
  for (const node of bench.callGraph.nodes.keys()) {
    callers.set(node, []);
    callees.set(node, []);
  }
  for (const edge of bench.callGraph.edges) {
    if (edge.from === edge.to) continue;
    // BOTH endpoints must be in the directory. A snapshot can carry a dangling edge, and honouring it would put a
    // caller into a service's list that `TOOL services` never named — a name the model could then answer with and
    // the case does not contain.
    const out = callees.get(edge.from);
    const into = callers.get(edge.to);
    if (out === undefined || into === undefined) continue;
    if (!out.includes(edge.to)) out.push(edge.to);
    if (!into.includes(edge.from)) into.push(edge.from);
  }

  const services = new Map<string, TelemetryService>();
  // A node with no metric series is still a candidate: the call graph names it, and a tool that refused to
  // describe it would teach the model that a service this case carries does not exist.
  for (const id of bench.callGraph.nodes.keys()) {
    // The two neighbour maps were seeded from this same key set two statements above, so a lookup here cannot
    // miss: the assertion is the statement, and a `?? []` would be a fallback no case can reach.
    services.set(id, {
      id,
      metrics: (bench.metrics.get(id) ?? []).map((one) =>
        summariseSeries(one.label, one.timestamps, [...one.values], bench.injectTime),
      ),
      callers: callers.get(id)!,
      callees: callees.get(id)!,
      firstErrorOffset: undefined,
      errorCount: 0,
      errorLines: [],
    });
  }

  const errors = new Map<
    string,
    { count: number; first: number; lines: { at: number; text: string }[] }
  >();
  for (const entry of bench.logs ?? []) {
    if (entry.level !== 'ERROR' && entry.level !== 'FATAL') continue;
    if (entry.timestamp < bench.injectTime) continue;
    const bucket = errors.get(entry.service) ?? { count: 0, first: entry.timestamp, lines: [] };
    bucket.count += 1;
    if (entry.timestamp < bucket.first) bucket.first = entry.timestamp;
    bucket.lines.push({ at: entry.timestamp, text: trimLine(entry) });
    errors.set(entry.service, bucket);
  }
  for (const [id, bucket] of errors) {
    const service = services.get(id);
    if (service === undefined) continue;
    // Oldest first: the producer's order is not guaranteed, and a transcript that reordered an incident would
    // invite the model to read a cause as an effect.
    const lines = [...bucket.lines]
      .sort((a, b) => a.at - b.at)
      .slice(0, LOG_LINES)
      .map((line) => line.text);
    services.set(id, {
      ...service,
      errorCount: bucket.count,
      firstErrorOffset: bucket.first - bench.injectTime,
      errorLines: lines,
    });
  }

  const failed = (bench.failedTraceEdges ?? []).map((edge) => ({
    caller: edge.caller,
    callee: edge.callee,
    failed: edge.failed,
    baseline: edge.baseline,
    // An absent instrument is a zero and not an unknown, because every rule that reads this field refuses a zero.
    novel: edge.novel ?? 0,
  }));
  const latency = (bench.edgeLatency ?? []).map((edge) => ({
    caller: edge.caller,
    callee: edge.callee,
    pre: edge.preMeanMs,
    post: edge.postMeanMs,
  }));

  return { injectTime: bench.injectTime, services, failed, latency };
}

/** Round a number for a prompt: three significant digits, no exponent at ordinary magnitudes. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return value.toFixed(0);
  if (magnitude >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}

/** One tool's answer. `refused` is a directory error, not an empty result. */
export interface ToolResult {
  readonly ok: boolean;
  readonly text: string;
  /** The service an `answer` directive resolved to, when it was accepted. */
  readonly resolved?: string;
  /** The cursor `next` advanced to, and `undefined` for every other directive. */
  readonly cursor?: number;
  /** The service a `next` directive consumed, so the loop can record it as investigated. */
  readonly served?: string;
}

/**
 * The order a `next` directive walks, and how far it has walked.
 *
 * The order is the ENGINE's, filtered to the services this case can describe, and it is held HERE rather than in the
 * prompt. That is the whole distinction this parameter exists for: iteration 318 measured a **seeded** prompt as
 * worse than a free arm — a printed list invites the model to re-rank it, which this repository has priced at chance
 * (`z = −9.26` over 5 335 claims) — while a **schedule** hands the model one service per call and discloses no
 * sequence at all. Same information the harness already owns, a different reader.
 */
export interface ScheduleCursor {
  /** Candidate ids in the engine's order, best first. Names this case does not carry are skipped. */
  readonly order: readonly string[];
  /** How many of them `next` has already served. */
  readonly cursor: number;
}

/**
 * Read one directive out of a reply.
 *
 * The grammar admits exactly two shapes and both are anchored at both ends:
 *
 * ```
 * TOOL <name> [argument]
 * ANSWER <service>
 * ```
 *
 * `ANSWER` is its own keyword rather than `TOOL answer <service>` because the terminal act is the one thing the
 * loop must not confuse with a query, and a keyword a model sees in the prompt is a keyword it will use. Prose
 * AROUND a directive is tolerated — a model that explains itself and then acts is still acting — but the
 * directive line itself must be exact, and a reply that contains none is `unparsed` rather than guessed at.
 * Guessing is how a measurement comes to record an answer the model never gave.
 *
 * @param reply - The assistant message, verbatim.
 * @returns The first directive in it, or `unparsed`.
 */
export function parseCall(reply: string): ParsedCall {
  for (const raw of reply.split('\n')) {
    const line = raw
      .trim()
      .replace(/^[`*_>\s]+|[`*_\s]+$/g, '')
      .trim();
    const parts = line.split(/\s+/);
    const head = parts[0]?.toUpperCase();
    if (head !== 'TOOL' && head !== 'ANSWER') continue;
    if (head === 'ANSWER') {
      const argument = parts.slice(1).join(' ');
      if (argument === '') return { kind: 'unparsed', text: line };
      return { kind: 'tool', tool: 'answer', argument };
    }
    if (parts.length < 2) return { kind: 'unparsed', text: line };
    const name = parts[1]!.toLowerCase();
    if (!(QUERY_TOOLS as readonly string[]).includes(name)) return { kind: 'unparsed', text: line };
    const argument = parts.slice(2).join(' ');
    const argumentFree =
      name === 'services' || name === 'failed' || name === 'fleet' || name === 'next';
    if (argumentFree && argument !== '') return { kind: 'unparsed', text: line };
    if (!argumentFree && argument === '') return { kind: 'unparsed', text: line };
    return { kind: 'tool', tool: name as QueryTool, argument };
  }
  return { kind: 'unparsed', text: reply.trim().slice(0, 200) };
}

/**
 * One metric as a line a prompt can carry.
 *
 * @param id - The service the series belongs to.
 * @param one - The series' window summary.
 * @returns The line.
 */
function renderMetricLine(id: string, one: TelemetryMetric, withTrough = false): string {
  const z = one.surprise === undefined ? 'n/a' : formatNumber(one.surprise);
  // The trough is printed only where the line is ABOUT a fall. A rise line that carried it would be longer text for
  // the same information, and the rise section's wording predates this field: keeping it byte-identical is what lets
  // a dispatch attribute a difference in the arm's answers to the collapse axis alone.
  const low = withTrough ? `low=${formatNumber(one.trough)} ` : '';
  return (
    `${id} ${one.label}: base=${formatNumber(one.baseline)} ${low}peak=${formatNumber(one.peak)} ` +
    `delta=${formatNumber(one.delta)} ratio=${formatNumber(one.ratio)} z=${z} ` +
    `at=${Math.round(one.peakOffset / 1000)}s`
  );
}

/**
 * Order two series by how far they FELL, deepest first.
 *
 * The mirror of {@link bySurprise}, and the same three rules in the same order: a standardised fall first (a series
 * whose pre-window has no level cannot be ranked against one that does), the absolute fall second, and the label last
 * so the text is a function of the data rather than of the producer's ordering.
 *
 * @param a - One series.
 * @param b - The other.
 * @returns Negative when `a` fell further.
 */
export function byFall(a: TelemetryMetric, b: TelemetryMetric): number {
  const left = a.fallSurprise;
  const right = b.fallSurprise;
  if (left !== undefined && right === undefined) return -1;
  if (left === undefined && right !== undefined) return 1;
  if (left !== undefined && right !== undefined && left !== right) return right - left;
  if (a.fall !== b.fall) return b.fall - a.fall;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * Order two series as a candidate LIST should be ordered.
 *
 * By surprise first, because a list is read for what it CONTAINS; by ratio second, because the two statistics
 * disagree most on exactly the series a list needs to carry; and by label last, so the text is a function of the
 * data rather than of the producer's ordering.
 *
 * @param a - The first series.
 * @param b - The second.
 * @returns A negative number when `a` should come first.
 */
export function bySurprise(a: TelemetryMetric, b: TelemetryMetric): number {
  const left = a.surprise;
  const right = b.surprise;
  if (left !== undefined && right === undefined) return -1;
  if (left === undefined && right !== undefined) return 1;
  if (left !== undefined && right !== undefined && left !== right) return right - left;
  if (a.ratio !== b.ratio) return b.ratio - a.ratio;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * The services a schedule can actually serve: the order's names, de-duplicated, restricted to the case's directory.
 *
 * Both filters are correctness rather than tidiness. A name the case does not carry cannot be described by any tool,
 * and serving it would spend one of the budget's ten calls to show the model a directory error. A repeated name would
 * spend a second call on a service the investigation has already seen — and the schedule's whole value is that its
 * slots land on distinct services.
 *
 * @param telemetry - The case's tool view.
 * @param order - Candidate ids, best first.
 * @returns The servable names, strongest first.
 */
export function scheduleNames(telemetry: Telemetry, order: readonly string[]): string[] {
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (id === '') continue;
    if (seen.has(id)) continue;
    if (!telemetry.services.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

/**
 * Execute one directive against the telemetry.
 *
 * @param telemetry - The case's tool view.
 * @param call - The parsed directive.
 * @param schedule - The order `next` walks, or `undefined` for an arm that carries none.
 * @returns The text the model is shown next, and whether that text answers the question.
 */
export function executeTool(
  telemetry: Telemetry,
  call: ParsedCall,
  schedule?: ScheduleCursor,
): ToolResult {
  if (call.kind === 'unparsed') {
    return {
      ok: false,
      text: 'refused: a directive must be one line, `TOOL <name> [argument]` or `ANSWER <service>`',
    };
  }
  const { tool, argument } = call;
  if (tool === 'next') {
    // A refusal rather than an empty result, for the reason every other refusal in this function is one: an arm that
    // carries no schedule must not teach the model that the case has no services left.
    if (schedule === undefined) {
      return {
        ok: false,
        text: 'refused: this arm carries no schedule; name a service with `TOOL metric <service>`',
      };
    }
    const usable = scheduleNames(telemetry, schedule.order);
    if (schedule.cursor >= usable.length) {
      return {
        ok: false,
        text:
          `refused: the schedule is exhausted after ${String(usable.length)} services; ` +
          'name a service with `TOOL metric <service>` or answer',
      };
    }
    const id = usable[schedule.cursor]!;
    // The schedule serves exactly what `TOOL metric <service>` would have shown, by CALLING it: one rendering, so a
    // scheduled read and a named read cannot drift into two different views of the same service.
    const answered = executeTool(telemetry, { kind: 'tool', tool: 'metric', argument: id });
    return {
      ok: answered.ok,
      text: `next ${String(schedule.cursor + 1)}/${String(usable.length)} — ${id}\n${answered.text}`,
      cursor: schedule.cursor + 1,
      served: id,
    };
  }
  if (tool === 'services') {
    const names = [...telemetry.services.keys()].sort();
    return { ok: true, text: `services (${names.length}): ${names.join(', ')}` };
  }
  if (tool === 'fleet') {
    // The fleet read exists because of a measured width: a corpus case carries ~50 services, and a budget of ten
    // single-service calls could not cover a tenth of it. One call has to be able to see the whole fleet, or the
    // arm's precision is a statement about how many services the budget reached.
    const entries: { id: string; metric: TelemetryMetric }[] = [];
    for (const [id, service] of telemetry.services) {
      let best: TelemetryMetric | undefined;
      for (const one of service.metrics) {
        if (best === undefined || bySurprise(one, best) < 0) best = one;
      }
      if (best !== undefined) entries.push({ id, metric: best });
    }
    if (entries.length === 0) return { ok: true, text: 'no metric series in this case' };
    const rises = [...entries]
      .sort((a, b) => bySurprise(a.metric, b.metric) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, FLEET_LINES);
    // The collapse axis is NOT the rise axis read backwards: a service can have its strongest RISE on cpu while
    // its traffic fell through the floor, and the second is the shape the prompt tells the model to take
    // seriously. So this reads each service's deepest FALL rather than the fall of its best ratio.
    const collapses: { id: string; metric: TelemetryMetric }[] = [];
    for (const [id, service] of telemetry.services) {
      let worst: TelemetryMetric | undefined;
      for (const one of service.metrics) {
        // `fall > 0` rather than `delta < 0`: a series that peaked above its baseline and then collapsed is the
        // shape a victim has, and a test on the peak excludes it by construction. `byFall` then orders the section
        // deepest first, with the same undefined-last rule `bySurprise` uses.
        if (one.fall > 0 && (worst === undefined || byFall(one, worst) < 0)) worst = one;
      }
      if (worst !== undefined) collapses.push({ id, metric: worst });
    }
    const falls = collapses
      .sort((a, b) => byFall(a.metric, b.metric) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, COLLAPSE_LINES);
    const lines = [`fleet: ${entries.length} services with metrics, ${rises.length} largest rises`];
    for (const entry of rises) lines.push(`  ${renderMetricLine(entry.id, entry.metric)}`);
    if (falls.length > 0) {
      lines.push(`falling: ${falls.length} of ${entries.length} services`);
      for (const entry of falls) lines.push(`  ${renderMetricLine(entry.id, entry.metric, true)}`);
    }
    return { ok: true, text: lines.join('\n') };
  }
  if (tool === 'failed') {
    if (telemetry.failed.length === 0)
      return { ok: true, text: 'no failed-interface counts in this case' };
    const ranked = [...telemetry.failed]
      .map((edge) => ({ ...edge, net: edge.failed - edge.baseline }))
      .sort((a, b) => b.net - a.net)
      .slice(0, FAILED_LINES);
    return {
      ok: true,
      text: ranked
        .map(
          (edge) =>
            `${edge.callee} <- ${edge.caller} net=${edge.net} failed=${edge.failed} pre=${edge.baseline}` +
            // Printed only where the producer measured it: a `novel=0` on every line would say "no new shapes" about
            // an instrument that was never run, which is the one statement this field must not make.
            (edge.novel > 0 ? ` novel=${edge.novel}` : ''),
        )
        .join('\n'),
    };
  }
  const known = [...telemetry.services.keys()];
  if (tool === 'answer') {
    const match =
      known.find((id) => id === argument) ??
      known.find((id) => id.toLowerCase() === argument.toLowerCase());
    if (match === undefined)
      return { ok: false, text: `refused: no service named "${argument}" in this case` };
    return { ok: true, text: `answer accepted: ${match}`, resolved: match };
  }
  const service = telemetry.services.get(argument);
  if (service === undefined)
    return { ok: false, text: `refused: no service named "${argument}" in this case` };
  if (tool === 'metric') {
    if (service.metrics.length === 0)
      return { ok: true, text: `${service.id}: no metrics in this case` };
    const ranked = [...service.metrics]
      .sort(bySurprise)
      .slice(0, METRIC_LINES)
      .map((one) => renderMetricLine(service.id, one));
    // The rises alone would hide the one shape the prompt tells the model to take seriously: a service whose
    // traffic COLLAPSED is a candidate even when it reports nothing, and its ratio is at the bottom of a
    // rise-sorted list by construction.
    const falls = [...service.metrics]
      .filter((one) => one.fall > 0)
      .sort(byFall)
      .slice(0, COLLAPSE_LINES)
      .map((one) => renderMetricLine(service.id, one, true));
    if (falls.length > 0) ranked.push('falling:', ...falls);
    return { ok: true, text: ranked.join('\n') };
  }
  if (tool === 'logs') {
    // The OFFSET is the existence test rather than the count: a bucket exists only because a line did, so the two
    // cannot disagree, and testing the offset is what makes the silent branch reachable instead of a coincidence.
    if (service.firstErrorOffset === undefined) {
      return { ok: true, text: `${service.id}: no ERROR or FATAL line at or after the injection` };
    }
    const head = `${service.id}: ${service.errorCount} error lines, first at +${Math.round(
      service.firstErrorOffset / 1000,
    )}s`;
    return { ok: true, text: [head, ...service.errorLines.map((line) => `  ${line}`)].join('\n') };
  }
  const latencies = telemetry.latency
    .filter((edge) => edge.caller === service.id || edge.callee === service.id)
    .slice(0, FAILED_LINES)
    .map(
      (edge) =>
        `${edge.caller}->${edge.callee} pre=${formatNumber(edge.pre)} post=${formatNumber(edge.post)}`,
    );
  return {
    ok: true,
    text: [
      `${service.id} callers=[${service.callers.join(', ')}] callees=[${service.callees.join(', ')}]`,
      ...latencies,
    ].join('\n'),
  };
}

/** The standing instruction: one string for every case, so a difference between cases is a difference in data. */
export const QUERY_SYSTEM_PROMPT = [
  'You are an incident investigator for a microservice system.',
  'A fault was injected at a known time. Exactly one service is the root cause: the service whose OWN fault the',
  'others are suffering from. A caller that reports errors is usually a victim, and a service that stopped',
  'receiving traffic can be the root cause even when it reports nothing.',
  '',
  'You may query the case. Answer with ONE line, every time:',
  '  TOOL services            list every service in this case',
  '  TOOL fleet               every service ranked by its strongest metric rise, in one call',
  "  TOOL metric <service>    that service's strongest metric rises against its own pre-injection baseline",
  "  TOOL logs <service>      that service's ERROR/FATAL lines after the injection",
  "  TOOL edges <service>     that service's callers, callees, and the latency on those edges",
  '  TOOL failed              interfaces that failed during the fault, by callee',
  '  ANSWER <service>         your final answer, naming one service from `TOOL services`',
  '',
  'Rules: one directive per reply, with no text before it. `at=` and `first at +` are seconds relative to the',
  'injection; a negative offset precedes it.',
  '',
  'Your budget is stated in every turn. An investigation that ends without an answer scores ZERO, so when a turn',
  'says LAST the only accepted reply is ANSWER: spend the turns before it on what decides the answer.',
].join('\n');

/**
 * The line an arm with a schedule adds to its standing instruction.
 *
 * Appended rather than folded into {@link QUERY_SYSTEM_PROMPT}, so the free arm's prompt stays byte-identical to the
 * one every published number in this repository was taken under. A schedule that edits the shared constant would
 * move two arms at once, and the resulting difference could not be attributed to either.
 *
 * What the line deliberately does NOT say: which services the schedule will serve, in which order, or that the order
 * is the engine's. The seeded prompt disclosed all three and lost to the free arm (§318); the schedule discloses the
 * existence of a route and one step of it at a time, which is the difference between a suggestion and a budget.
 */
export const SCHEDULE_TOOL_LINE = [
  '',
  "A schedule is available: `TOOL next` answers with the next service in the pipeline's own order and spends one",
  'call, so ten calls reach ten distinct services instead of whatever the fleet read happened to surface. It is a',
  'route and not an instruction: naming a service yourself stays available, and a service the schedule would not',
  'reach is exactly the case worth spending a call on.',
].join('\n');

/**
 * The standing instruction of an arm that carries a schedule.
 *
 * Exported as the COMPOSITION rather than assembled at the call site, so the one prompt every accepted directive
 * must appear in is a value a test can read. `QUERY_SYSTEM_PROMPT` stays untouched beside it: the free arm's prompt
 * is the one every published number in this repository was taken under, and a schedule that edited it would move two
 * arms at once.
 */
export const SCHEDULED_SYSTEM_PROMPT = `${QUERY_SYSTEM_PROMPT}\n${SCHEDULE_TOOL_LINE}`;

/** One exchange: the directive, and the text it produced. */
export interface QueryExchange {
  readonly round: number;
  readonly directive: string;
  readonly result: string;
  readonly ok: boolean;
}

/** How much of the budget is left, in the two currencies the model plans with. */
export interface BudgetState {
  /** The turn about to be taken, counting from one. */
  readonly round: number;
  readonly maxRounds: number;
  /** Tool calls that may still be EXECUTED. */
  readonly callsLeft: number;
  /** Whether this turn only accepts an answer. */
  readonly forcing: boolean;
}

/**
 * The budget as a line the model reads before it decides.
 *
 * A wall the model cannot see is not a budget, it is an ambush: the first pilot ended **155 of 160** investigations
 * on the round cap with no answer given, because nothing in the prompt said how many turns were left or that an
 * unanswered case scores zero. The model did not fail to choose — it was never told it had to.
 *
 * @param state - The round, the calls left, and whether answering is compulsory.
 * @returns The line.
 */
export function renderBudget(state: BudgetState): string {
  const calls = state.callsLeft === 1 ? '1 tool call left' : `${state.callsLeft} tool calls left`;
  if (state.forcing) {
    return (
      `Budget: round ${state.round} of ${state.maxRounds} — LAST turn. ` +
      'No tool call is accepted now. Reply with one line: ANSWER <service>.'
    );
  }
  return (
    `Budget: round ${state.round} of ${state.maxRounds}, ${calls}. ` +
    'Answer before either runs out — an unanswered case scores zero.'
  );
}

/** The budget, all of it caps rather than hopes. */
export interface QueryBudget {
  /** Assistant turns. One directive per turn, so this is also the number of calls attempted. */
  readonly maxRounds: number;
  /** Tool calls that may be EXECUTED. A refused directive costs a round and not a call. */
  readonly maxToolCalls: number;
  /** Characters of transcript carried into the next prompt, oldest results elided first. */
  readonly transcriptChars: number;
}

/** Defaults: six turns, ten calls, and a 9 000-character transcript. */
export const DEFAULT_QUERY_BUDGET: QueryBudget = {
  maxRounds: 6,
  maxToolCalls: 10,
  transcriptChars: 9_000,
};

/**
 * How much of the investigation an artifact row carries.
 *
 * The v2 pilot answered 160 of 160 cases and was still 26 cases worse than the engine, and the artifact could not
 * say why: a row carried rounds, calls and tokens but not one exchange. Smaller than the prompt's own budget,
 * because this is a record of the END of the investigation — the part the answer was made from.
 */
export const TRACE_CHARS = 2_000;

/** What one case's investigation produced. */
export interface QueryOutcome {
  /** The service the arm answers with: the model's own when admitted, else the prior. */
  readonly answer: string | null;
  /**
   * The model's FIRST answer that resolved to a service the case carries, before any gate.
   *
   * Kept because it is what an ungated arm would have returned on this case, and the three gate policies are
   * therefore priced from one artifact rather than from three runs. `null` when the model never named one.
   */
  readonly rawAnswer: string | null;
  /** Who produced {@link answer}: the model, the prior the gate fell back to, or a resolver rule. */
  readonly answeredBy: 'model' | 'prior' | 'entry' | 'interface' | 'door' | 'certainty' | null;
  /** How many answers the gate refused. A refused answer costs a round and not a tool call. */
  readonly gateRefusals: number;
  /** Services the investigation executed a per-service query against, in first-query order. */
  readonly investigated: readonly string[];
  /** Why the last answer was refused, when one was. */
  readonly answerRefused: string | null;
  readonly exchanges: readonly QueryExchange[];
  /** The end of the investigation, as the artifact keeps it. */
  readonly trace: string;
  readonly rounds: number;
  readonly toolCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly stop: 'answered' | 'rounds' | 'tool-calls';
}

/**
 * Render the transcript for the next prompt, keeping the NEWEST results and eliding the oldest.
 *
 * The newest are the ones the next directive is about, so the direction is not a preference: eliding the recent
 * half would leave the model reading a conversation that stopped before its own question. The last exchange is
 * always kept even when it alone exceeds the cap, because a cap that empties the transcript is a silent reset and
 * the model would answer the same question again.
 *
 * @param exchanges - Everything said so far.
 * @param budget - Character cap.
 * @returns The transcript text.
 */
export function renderTranscript(
  exchanges: readonly QueryExchange[],
  budget: QueryBudget = DEFAULT_QUERY_BUDGET,
): string {
  const blocks = exchanges.map(
    (exchange) => `${exchange.directive}\n=> ${exchange.ok ? '' : 'REFUSED '}${exchange.result}`,
  );
  const kept: string[] = [];
  let total = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (kept.length > 0 && total + block.length > budget.transcriptChars) break;
    kept.unshift(block);
    total += block.length;
  }
  const dropped = blocks.length - kept.length;
  return (dropped > 0 ? [`${ELIDED} (${dropped})`, ...kept] : kept).join('\n\n');
}

/** The stand-in a transcript uses for a result it no longer carries. */
const ELIDED = '[earlier results elided]';

/**
 * An order handed to the model BEFORE it investigates.
 *
 * ## Why this exists, and why it is a parameter rather than a decision
 *
 * `docs/free-investigation.md` §5 pins the arm's design to a measured floor: whatever ranking the harness shows
 * first is what the arm scores, because the model copies it. The first two readings priced that exactly. With no
 * order at all, the first thing the arm sees is `TOOL fleet`, so it reranks a max-ratio list and scores **33.75 %**
 * against the engine's **50.0 %**; asked to rerank a 30-wide engine list it moves 61 of 1 422 cases at precision
 * 0.475 and scores **1 153** against the engine's **1 156**. Both numbers are what a copy with noisy edits scores.
 *
 * So the arm's floor is not a property of the model. It is the accuracy of the first list it is shown, which makes
 * seeding a design variable with its OWN floor and its own falsifier — and that is why it is here as an option that
 * a dispatch turns on, not as a constant.
 */
export interface QuerySeed {
  /** The order's name, as a transcript should record it. `engine` for this repository's own ranker. */
  readonly source: string;
  /** Candidate service ids, strongest first. Only the ones the case carries survive rendering. */
  readonly candidates: readonly string[];
}

/**
 * The prior's names that this case can actually describe.
 *
 * Two filters, and the first is a correctness one rather than a cosmetic one: **a name the case does not carry is
 * dropped, not printed.** A prior quoting a service no tool can describe is evidence the model cannot check, and an
 * answer to it would be refused at the terminal step anyway. The de-duplication is the second: a repeated name
 * would consume a rank, and the rank is what a gate reads to know which name it is defending.
 *
 * @param seed - The order.
 * @param telemetry - The case, for the existence test.
 * @returns The surviving names, strongest first.
 */
export function seedNames(seed: QuerySeed, telemetry: Telemetry): string[] {
  const kept: string[] = [];
  for (const name of seed.candidates) {
    if (name === '') continue;
    if (!telemetry.services.has(name)) continue;
    if (kept.includes(name)) continue;
    kept.push(name);
  }
  return kept;
}

/**
 * The prior's first name, which is the one thing a gate has to defend.
 *
 * @param seed - The order, or `null` for a free arm.
 * @param telemetry - The case, for the existence test.
 * @returns The name, or `null` when the arm has no prior whose first name this case carries.
 */
export function priorTopOf(seed: QuerySeed | null, telemetry: Telemetry): string | null {
  if (seed === null) return null;
  return seedNames(seed, telemetry)[0] ?? null;
}

/**
 * Render the prior for a prompt.
 *
 * Two properties beside the filter in {@link seedNames}, each asserted rather than assumed:
 *
 * * **The numbering restarts after a drop**, so a gap in the list cannot be read as a rank the harness withheld.
 * * **The block says what it is.** A prior presented as an answer is a copy with extra steps, which is the exact
 *   failure the two earlier readings measured; the sentence that calls it a prior is the whole difference.
 *
 * @param seed - The order.
 * @param telemetry - The case, for the existence test.
 * @returns The block, or `''` when nothing survives — an empty prior teaches the model nothing and costs a prompt.
 */
export function renderSeed(seed: QuerySeed, telemetry: Telemetry): string {
  const kept = seedNames(seed, telemetry);
  if (kept.length === 0) return '';
  const lines = [
    `The ${seed.source} order, strongest first. This is a PRIOR, not an answer — the engine is wrong on some cases,`,
    'and evidence that contradicts it is the reason to investigate.',
  ];
  for (const [index, name] of kept.entries()) lines.push(`  ${index + 1}. ${name}`);
  return lines.join('\n');
}

/**
 * What an override has to show before it replaces the prior.
 *
 * ## Why this is a policy rather than a sentence in a prompt
 *
 * Iteration 318 measured the arm's failure and it was not a capability: seeded with the engine's top-5, the model
 * agreed with the engine's rank-1 on **45.0 %** of cases and substituted its own answer on the other 55 %, at
 * precision **0.263** against a 0.500 break-even. The width-30 table arm, asked only to RANK, moved **4.3 %** of
 * cases at precision 0.475. Two surfaces, **13× apart in how often they intervene**, and precision falls as
 * intervention rises.
 *
 * `arXiv:2611.05390` names the missing object and prices it: an override authority that is *gated* by "a mechanically
 * valid record of a binding-constraint violation" cuts corruption of correct proposals while keeping most repairs —
 * and, in its prospective arm, a gate whose rule lived in the prompt did not hold for every model. So the rule is
 * enforced here, in the harness, after the model has spoken, against a record the harness already owns.
 *
 * * `none` — the control. Every override is admitted, which is the surface 318 measured.
 * * `cited` — an override is admitted only if the investigation executed a query about the service it names. The
 *   transcript is the record, so this is decidable with no second model call and no judge.
 * * `cone` — `cited`, plus the direction the domain already knows: the named service must sit on the prior's
 *   **callee side**, because a root cause is reached by descending and a caller that reports errors is the victim.
 * * `contrast` — `cone`, plus the evidence that separates a source from a victim at the same position
 *   ({@link leadsEvidence}). Strictly narrower than `cone`, so it can never admit what `cone` refuses.
 * * `lag` — `cone`, plus the ORDER axis of {@link leadsEvidence} alone ({@link lagLeads}). Strictly narrower than
 *   `contrast`, and it exists because `contrast`'s interface axis was **refuted as a source test** by the 160-case
 *   pricing: a failing interface `prior -> answer` is what a failing CALLER looks like on every one of its callees,
 *   so the axis admits the prior's victims. On that artifact it admitted 4 breaks against 1 repair, while the order
 *   axis alone admitted 10 repairs and 0 breaks (precision 1.000, retention 1.000). Both policies stay: `contrast`
 *   is the registered arm whose reading is documented, and a rule that changed under a published name would
 *   invalidate every number taken under it.
 */
export type GatePolicy = 'none' | 'cited' | 'cone' | 'contrast' | 'lag';

/**
 * The policies whose admission test reads the case's own evidence.
 *
 * Named once so the prompt cannot offer a rule the harness does not enforce, and so the evidence block is built for
 * exactly these two: building it for a policy that ignores it would charge that arm a graph walk and an onset
 * comparison for nothing, and NOT building it for one that reads it fails the gate closed on every override.
 */
const EVIDENCE_POLICIES: readonly GatePolicy[] = ['contrast', 'lag'];

/**
 * What one service's own telemetry says, in terms a victim cannot forge.
 *
 * Two quantities, both read off the case rather than off the transcript, because a service that a model never
 * queried still has telemetry and the harness owns it either way.
 *
 * * `firstError` — milliseconds from the injection to its first `ERROR`/`FATAL` line, or `null` when it logged none.
 * * `fall` — its deepest series collapse as a delta, or `null` when nothing fell.
 */
export interface Onset {
  readonly firstError: number | null;
  readonly fall: number | null;
}

/**
 * Read one service's own evidence.
 *
 * @param telemetry - The case's tool view.
 * @param id - The service.
 * @returns Its evidence, or `undefined` when the case does not carry the name.
 */
export function onsetOf(telemetry: Telemetry, id: string): Onset | undefined {
  const service = telemetry.services.get(id);
  if (service === undefined) return undefined;
  let fall: number | null = null;
  for (const one of service.metrics) {
    if (one.delta < 0 && (fall === null || one.delta < fall)) fall = one.delta;
  }
  return { firstError: service.firstErrorOffset ?? null, fall };
}

/**
 * Net failures on one directed interface during the fault, or `null` when the case carries no such interface.
 *
 * @param telemetry - The case's tool view.
 * @param caller - The calling side.
 * @param callee - The called side.
 * @returns `failed - baseline`, so a positive number is an interface that began failing.
 */
export function netBetween(telemetry: Telemetry, caller: string, callee: string): number | null {
  const edge = telemetry.failed.find((one) => one.caller === caller && one.callee === callee);
  return edge === undefined ? null : edge.failed - edge.baseline;
}

/**
 * Whether a candidate's own evidence says it is the source rather than the victim.
 *
 * ## The theory, and the one axis that was registered and then refused
 *
 * **LagRCA** (FSE Companion '26, `10.1145/3803437.3805219`) states the failure this predicate exists for: causes and
 * symptoms are *misaligned in time*, so a method that reads them synchronously "can dilute true upstream culprits
 * while over-ranking downstream victims". Its own industrial measurement fixes the shape of the rule — **18.49 %**
 * of incidents erupt synchronously, so the lag is real but absent in a fifth of cases, and a conjunction would
 * refuse every override there.
 *
 * So this is a disjunction of the two axes a victim cannot manufacture:
 *
 * * **the interface** — the failing interface between the two runs from the prior INTO the candidate and not back
 *   out of it. A failing interface is a *call that failed*, and the callee is the end the call reached.
 * * **the lag** — the candidate logged its first error **strictly earlier**. A caller cannot report a callee's
 *   failure before the callee produces it; that is LagRCA's $\tau > 0$, and it is also why a prior that logged
 *   nothing at all is not counter-evidence.
 *
 * A third axis — the deepest series collapse — was pre-registered as `E3` and **dropped**, because this package's
 * own fixture refutes it: `checkout`'s traffic falls from 100 to 20 precisely *because* `payment` is down, so a
 * deeper collapse admits the victim. The negative result is kept in the test suite so it cannot be re-invented.
 *
 * Note what is deliberately absent: any comparison of the two sides' anomaly z. Under amplification a victim's z
 * exceeds its source's, so `z(answer) > z(prior)` would admit almost everything and collapse `contrast` into
 * `cone` — the degenerate form is rejected here rather than discovered afterwards.
 *
 * @param answer - The candidate's evidence.
 * @param prior - The prior's evidence.
 * @param intoAnswer - Net failures on `prior -> answer`, or `null` when no such interface is recorded.
 * @param intoPrior - Net failures on `answer -> prior`.
 * @returns Whether the candidate leads.
 */
export function leadsEvidence(
  answer: Onset | undefined,
  prior: Onset | undefined,
  intoAnswer: number | null,
  intoPrior: number | null,
): boolean {
  if (intoAnswer !== null && intoAnswer > 0 && intoAnswer > (intoPrior ?? 0)) return true;
  return lagLeads({ answer, prior, intoAnswer, intoPrior });
}

/**
 * The ORDER axis alone: the candidate logged its first error strictly before the prior did.
 *
 * ## Why this is a policy and not the second half of one
 *
 * `contrast` is a disjunction, and a disjunction cannot say which of its terms did the work. The 160-case pricing
 * separated them: of the four breaks `contrast` admitted, **all four** entered through the interface term, and the
 * interface term bought one repair for them. The order term alone admitted **ten repairs and no break** on the same
 * artifact, at precision 1.000 and retention 1.000.
 *
 * The reason is a property of the graph rather than of this corpus: an interface that fails from `prior` into
 * `answer` is exactly what a **failing caller** produces on every callee it has left, so the term admits the prior's
 * own victims whenever the prior is the source. Order is not ambiguous in that way — a caller cannot report a
 * callee's failure before the callee produces it.
 *
 * The two branches this inherits are stated rather than defaulted: a candidate that logged **nothing** is refused
 * (absence is not a lead), and a **prior** that logged nothing is not counter-evidence, so the candidate is admitted.
 *
 * @param evidence - Both sides' onsets.
 * @returns Whether the candidate's first error precedes the prior's.
 */
export function lagLeads(evidence: ContrastEvidence): boolean {
  const { answer, prior } = evidence;
  if (answer === undefined) return false;
  if (answer.firstError === null) return false;
  if (prior === undefined || prior.firstError === null) return true;
  return answer.firstError < prior.firstError;
}

/** Everything `contrast` reads: both sides' own telemetry, and which way the interface between them failed. */
export interface ContrastEvidence {
  readonly answer: Onset | undefined;
  readonly prior: Onset | undefined;
  readonly intoAnswer: number | null;
  readonly intoPrior: number | null;
}

/** What a gate is checked against: the prior, the record, the direction, and — for `contrast` — the evidence. */
export interface GateContext {
  /** The service the prior puts first, or `null` when the arm has no prior. */
  readonly priorTop: string | null;
  /** Services the investigation executed a per-service query against. A REFUSED query is not a record. */
  readonly cited: ReadonlySet<string>;
  /** Whether the candidate sits on the prior's callee-side cone. */
  readonly onCone: boolean;
  /** The evidence `contrast` reads. Required by that policy and ignored by the other three. */
  readonly evidence?: ContrastEvidence;
}

/**
 * Decide whether an answer may replace the prior.
 *
 * Three exemptions, each a statement rather than a convenience:
 *
 * * `none` admits everything, because a control that gated would not be a control.
 * * An arm with **no prior** has nothing to defend — the gate is a rule about overriding, so it admits.
 * * An answer that **is** the prior's first name is not an override at all.
 *
 * @param policy - The rule.
 * @param answer - The service the model named, already resolved to one the case carries.
 * @param context - The prior, the record and the direction.
 * @returns Whether the answer may stand.
 */
export function gateAdmits(policy: GatePolicy, answer: string, context: GateContext): boolean {
  if (policy === 'none') return true;
  if (context.priorTop === null) return true;
  if (answer === context.priorTop) return true;
  if (!context.cited.has(answer)) return false;
  if (policy === 'cited') return true;
  if (!context.onCone) return false;
  if (policy === 'cone') return true;
  // Both remaining policies read evidence and both FAIL CLOSED on a missing block: a policy that admitted when its
  // own input was absent would be a wider `cone` under a narrower name, and 320's pre-registration priced
  // `contrast` as strictly narrower.
  if (context.evidence === undefined) return false;
  if (policy === 'lag') return lagLeads(context.evidence);
  return leadsEvidence(
    context.evidence.answer,
    context.evidence.prior,
    context.evidence.intoAnswer,
    context.evidence.intoPrior,
  );
}

/**
 * Whether a service sits on another's callee-side cone — the direction a fault travels.
 *
 * Strict in the sense that matters: the origin is not on its own cone, because "downstream of itself" is not a
 * direction. The walk is breadth-first over `callees` with a visited set, because a real call graph carries cycles
 * (this package's own fixture carries a self-call) and a recursive walk without one would not terminate.
 *
 * @param telemetry - The case's call graph.
 * @param candidate - The service to reach.
 * @param priorTop - The origin, or `null` when there is no prior.
 * @returns Whether the candidate is reachable from the origin by descending.
 */
export function onPriorCone(
  telemetry: Telemetry,
  candidate: string,
  priorTop: string | null,
): boolean {
  if (priorTop === null) return false;
  if (candidate === priorTop) return false;
  if (!telemetry.services.has(candidate)) return false;
  const seen = new Set<string>([priorTop]);
  const queue = [priorTop];
  while (queue.length > 0) {
    const here = queue.shift()!;
    // The assertion is the argument, not a shortcut: `priorTop` was tested against this directory and every node
    // pushed below came out of a `callees` list that `buildTelemetry` seeded from the same key set, so a miss here
    // is unreachable. A `?? []` would be a branch no case can take, reported as coverage rather than read as one.
    for (const next of telemetry.services.get(here)!.callees) {
      if (next === candidate) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * The gate as a line the model reads BEFORE it answers.
 *
 * A rule the model discovers by refusal is an ambush, and iteration 316 priced exactly that: 155 of 160
 * investigations ended without an answer because nothing in the prompt said the answer was compulsory. The same
 * argument applies to a rule that discards answers, so the policy, the name it protects and the tool shapes that
 * satisfy it are printed on every turn the gate is on.
 *
 * @param policy - The rule.
 * @param priorTop - The prior's first name, or `null` when there is no prior to defend.
 * @returns The line, or `''` when the arm is ungated.
 */
export function renderGate(policy: GatePolicy, priorTop: string | null): string {
  if (policy === 'none' || priorTop === null) return '';
  const rule =
    `Gate: \`ANSWER X\` is accepted only if X is \`${priorTop}\` — the prior's first — or you have already queried ` +
    'X itself in this investigation, with `TOOL metric X`, `TOOL logs X` or `TOOL edges X`.';
  const cone =
    policy === 'cone'
      ? ` X must also sit on ${priorTop}'s callee side: a caller that reports errors is usually the victim.`
      : policy === 'contrast'
        ? ` X must also sit on ${priorTop}'s callee side AND its own telemetry must show it LEADS ${priorTop}: ` +
          `either \`TOOL failed\` shows the interface ${priorTop} -> X failing (its net= above 0) and not the ` +
          `reverse, or \`TOOL logs X\` shows X's first error EARLIER than ${priorTop}'s. ` +
          'Position alone is not evidence: a callee can be its own callee’s victim.'
        : policy === 'lag'
          ? ` X must also sit on ${priorTop}'s callee side AND \`TOOL logs X\` must show X's first error EARLIER ` +
            `than ${priorTop}'s own first error. A caller cannot report a callee's failure before the callee ` +
            `produces it, so a callee that logs later — or not at all — is a victim so far. Position and a failing ` +
            'interface are not enough: a caller that has failed fails its calls to everything below it.'
          : // `cited` states a record requirement and no direction: the empty string is that policy's statement, not
            // a fallback for a branch no policy takes.
            '';
  return [
    rule + cone,
    'A refused answer is replaced by the prior, so a guess costs a turn and gains nothing: spend it on a query.',
  ].join('\n');
}

/** The per-case question. */
export function buildUserPrompt(
  telemetry: Telemetry,
  exchanges: readonly QueryExchange[],
  state?: BudgetState,
  seed?: QuerySeed | null,
  policy: GatePolicy = 'none',
  incumbent?: string | null,
): string {
  const names = [...telemetry.services.keys()].sort();
  const head = [
    `Incident: a fault was injected at t=0. This case carries ${names.length} services.`,
    'Deliverable: one `ANSWER <service>` line.',
  ];
  if (state !== undefined) head.push(renderBudget(state));
  // The name the gate defends is the FALLBACK's first, which is not always the prior the prompt shows: an arm that
  // shows no order and still ships the engine's answer must state the rule it enforces. A rule the model is judged
  // by and never told is the failure `the gate is stated in the prompt` pins, so the incumbent is passed in rather
  // than re-derived from the seed here.
  const priorTop =
    incumbent === undefined
      ? seed === undefined || seed === null
        ? null
        : priorTopOf(seed, telemetry)
      : incumbent;
  if (seed !== undefined && seed !== null) {
    const prior = renderSeed(seed, telemetry);
    if (prior !== '') head.push('', prior);
  }
  const gate = renderGate(policy, priorTop);
  if (gate !== '') head.push('', gate);
  const opening = head.join('\n');
  const transcript = renderTranscript(exchanges);
  return transcript === '' ? `${opening}\n\nNo queries yet.` : `${opening}\n\n${transcript}`;
}

/** What the loop needs from a model, so it is testable against a fake that never touches a network. */
export interface QueryAgentClient {
  readonly model: string;
  complete(turn: { system: string; user: string }): Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
  }>;
}

/** What a turn that accepts only an answer says when it is given anything else. */
const LAST_TURN_ONLY = 'refused: this was the last turn, and only `ANSWER <service>` is accepted';

/**
 * Investigate one case.
 *
 * ## The order the arm SHOWS and the order a refusal falls back to are two decisions
 *
 * Every arm shipped before this parameter showed the same order it fell back to, so one argument carried both and
 * the free arm (`seed: null`) had no fallback by construction. The two are separate: an arm can show nothing and
 * still ship the engine's answer when the model offers none the gate will admit, which is the surface a product
 * with an engine underneath actually has. `fallback` defaults to `seed` for that reason — the shipped arms keep
 * their exact behaviour, and an arm whose fallback differs from what it shows is asked for rather than inferred.
 *
 * @param client - The model.
 * @param telemetry - The case's tool view.
 * @param budget - Rounds, calls and transcript size.
 * @param seed - An order to show the model before it investigates, or `null` for a free arm.
 * @param policy - What an override must show before it replaces the prior.
 * @param resolution - Which post-answer reader may rename the settled answer.
 * @param fallback - The order a refusal settles on, and the incumbent the gate defends. Defaults to {@link seed}.
 * @param engine - The engine's opinion, for the resolvers that read it.
 * @param schedule - The order a `next` directive walks, or `null` for an arm that carries none. Held by the harness
 *   and never printed: this is the difference between a schedule and a seed.
 * @returns The answer, the transcript, and what the arm spent.
 */
export async function runQueryAgent(
  client: QueryAgentClient,
  telemetry: Telemetry,
  budget: QueryBudget = DEFAULT_QUERY_BUDGET,
  seed: QuerySeed | null = null,
  policy: GatePolicy = 'none',
  resolution: Resolution = 'none',
  fallback: QuerySeed | null = seed,
  engine: EngineOpinion | null = null,
  schedule: readonly string[] | null = null,
): Promise<QueryOutcome> {
  const exchanges: QueryExchange[] = [];
  const investigated: string[] = [];
  const cited = new Set<string>();
  // The incumbent: what the gate defends and what a refusal ships. It is NOT necessarily what the prompt shows.
  const priorTop = priorTopOf(fallback, telemetry);
  let rounds = 0;
  let toolCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let answerRefused: string | null = null;
  let stop: QueryOutcome['stop'] = 'rounds';
  let rawAnswer: string | null = null;
  let gateRefusals = 0;
  /** How far a `next` directive has walked. Harness state, never shown: the schedule discloses one step, not a list. */
  let cursor = 0;

  // Read once: the witness is a property of the CASE, not of the answer, so every settlement in this investigation
  // reads the same interface evidence.
  const witnessed = readInterfacePrior(telemetry);

  /**
   * The resolver, applied where the answer is SETTLED rather than where it is proposed.
   *
   * Placement is the whole design. A gate that refused an answer has already decided which name stands; a resolver
   * that ran before it would be asking the gate about a candidate the model never named, and the artifact could no
   * longer price the two independently. Running it after means the artifact's `rawAnswer` still records the model's
   * own name, the gate's own decision is unchanged, and the rule is a SECOND READER of the same case — which is
   * why it is priced from one artifact at zero cost instead of from a second dispatch.
   *
   * It is applied to the prior as well, because a refusal falls back to the prior and a fallback that was never read
   * is a name the rule was not allowed to check. And it is applied through {@link applyResolver}, so the mode names
   * a rule the PRICING also has — a resolver priced by one implementation and shipped by another is two rules, and
   * the artifact would measure the one nobody runs.
   */
  const attribute = (
    answer: string | null,
  ): { answer: string | null; by: QueryOutcome['answeredBy'] } => {
    if (resolution === 'none' || answer === null) return { answer, by: null };
    const to = applyResolver(
      answer,
      { ...readEntryPrior(telemetry, answer), ...witnessed },
      resolution,
      // The ENGINE's opinion, which is a property of the verdict rather than of the prompt: a free arm is handed no
      // order and still ships a case the engine was decided about, so the two are passed separately.
      engine,
    );
    return { answer: to.answer, by: to.by };
  };

  /**
   * The arm's one and only exit.
   *
   * Every route out of the loop — an answer inside the budget, an answer on the FORCED last round, the fallback to
   * the prior, and the control's refusal to have a fallback at all — comes through here, because the resolver is
   * wired into this function rather than into its callers. Iteration 322 shipped it at two of the three answering
   * sites and the dispatch found it inert on 76 of the 87 answers it was registered to rename: the corpus answers
   * on round six, which is the forcing round, and that settlement was written before the resolver existed. A rule
   * that must read EVERY settled answer cannot depend on a future author remembering to call it — so there is one
   * call site, and adding a fourth route out of the loop cannot leave the rule behind again.
   *
   * @param stop - How the investigation ended.
   * @param answer - The name the gate settled on, or `null` when the arm has no fallback.
   * @param answeredBy - Who settled it, before the resolver reads it.
   * @returns The outcome, with the resolver's rename applied if the rule fires.
   */
  const settle = (
    stop: QueryOutcome['stop'],
    answer: string | null,
    answeredBy: QueryOutcome['answeredBy'],
  ): QueryOutcome => {
    const attributed = attribute(answer);
    return {
      answer: attributed.answer,
      rawAnswer,
      answeredBy: attributed.by ?? answeredBy,
      gateRefusals,
      investigated,
      answerRefused,
      exchanges,
      trace: renderTranscript(exchanges, { ...budget, transcriptChars: TRACE_CHARS }),
      rounds,
      toolCalls,
      promptTokens,
      completionTokens,
      stop,
    };
  };

  /**
   * Everything a gate reads about one candidate.
   *
   * The evidence block is built for the two EVIDENCE policies only, because the others must not pay for it: an arm
   * whose prompt is the same as 319's must read the same as 319's, or the two runs are not comparable.
   */
  const gateContextFor = (candidate: string): GateContext => {
    // The three DIRECTION policies read the cone; `cited` does not, and a cone nobody consults is a graph walk
    // nobody needs. The list is written out rather than derived, because the fact being stated is which policies
    // the domain's direction belongs to, not which ones happen to read evidence.
    const onCone =
      policy === 'cone' || policy === 'contrast' || policy === 'lag'
        ? onPriorCone(telemetry, candidate, priorTop)
        : false;
    if (!EVIDENCE_POLICIES.includes(policy) || priorTop === null)
      return { priorTop, cited, onCone };
    return {
      priorTop,
      cited,
      onCone,
      evidence: {
        answer: onsetOf(telemetry, candidate),
        prior: onsetOf(telemetry, priorTop),
        intoAnswer: netBetween(telemetry, priorTop, candidate),
        intoPrior: netBetween(telemetry, candidate, priorTop),
      },
    };
  };

  /**
   * Ask the gate about one resolved answer, recording the model's first one as the raw answer.
   *
   * The refusal text names the rule and the two ways to satisfy it, because a refusal the model cannot act on is a
   * round spent twice. The direction test is only computed under the policy that reads it: a cone nobody consults is
   * a graph walk nobody needs.
   */
  const admit = (resolved: string): { ok: boolean; text: string } => {
    if (rawAnswer === null) rawAnswer = resolved;
    const context = gateContextFor(resolved);
    if (gateAdmits(policy, resolved, context)) return { ok: true, text: '' };
    gateRefusals += 1;
    // A refusal is only reachable with a prior in hand — `gateAdmits` admits whatever it is given when there is
    // none — so this is an assertion rather than a fallback, and a `??` here would be a branch no case can take.
    const prior = priorTop!;
    const text = !cited.has(resolved)
      ? `refused by the gate: an override must be investigated first. Run \`TOOL metric ${resolved}\`, ` +
        `\`TOOL logs ${resolved}\` or \`TOOL edges ${resolved}\`, or answer \`${prior}\`.`
      : !context.onCone
        ? `refused by the gate: ${resolved} is not on ${prior}'s callee side, and a caller that reports errors is ` +
          `usually the victim. Query the callee side, or answer \`${prior}\`.`
        : // Only the two evidence policies reach this branch: `cone` admits whatever is cited and on the cone. The
          // text names the axis the DISPATCHED policy reads, because a refusal the model cannot act on costs two
          // rounds — the one it spent and the one it re-spends on the same guess.
          policy === 'lag'
          ? `refused by the gate: ${resolved} sits below ${prior} but did not log its first error EARLIER than ` +
            `${prior}. A caller cannot report a callee's failure before the callee produces it, so a callee that ` +
            `logs later — or not at all — is a victim so far. Check \`TOOL logs ${resolved}\` and \`TOOL logs ` +
            `${prior}\`, or answer \`${prior}\`.`
          : `refused by the gate: ${resolved} sits below ${prior} but its own telemetry does not LEAD — the interface ` +
            `${prior} -> ${resolved} did not fail, and ${resolved} did not log its first error earlier than ` +
            `${prior}. A callee can be its own callee's victim. Check \`TOOL failed\` and \`TOOL logs ${resolved}\`, ` +
            `or answer \`${prior}\`.`;
    answerRefused = text;
    return { ok: false, text };
  };

  while (rounds < budget.maxRounds) {
    rounds += 1;
    const callsLeft = Math.max(0, budget.maxToolCalls - toolCalls);
    // Two ways to be out of runway: the rounds, or the calls. Either one turns this turn into the turn where the
    // only thing worth saying is the answer, and both are ANNOUNCED in the prompt that asks for it.
    const forcing = rounds === budget.maxRounds || callsLeft === 0;
    const completion = await client.complete({
      system: schedule === null ? QUERY_SYSTEM_PROMPT : SCHEDULED_SYSTEM_PROMPT,
      user: buildUserPrompt(
        telemetry,
        exchanges,
        {
          round: rounds,
          maxRounds: budget.maxRounds,
          callsLeft,
          forcing,
        },
        seed,
        policy,
        priorTop,
      ),
    });
    promptTokens += completion.promptTokens;
    completionTokens += completion.completionTokens;
    const call = parseCall(completion.text);
    // The terminal act is rendered with its own keyword, not as `TOOL answer`: a transcript that spells the answer
    // the same way it spells a query cannot be read to say when the investigation stopped.
    const directive =
      call.kind === 'unparsed'
        ? `UNPARSED: ${call.text.slice(0, 80)}`
        : call.tool === 'answer'
          ? `ANSWER ${call.argument}`
          : `TOOL ${call.tool}${call.argument === '' ? '' : ` ${call.argument}`}`;
    if (forcing) {
      // The runway is gone either way, and WHICH one ran out is what the artifact reports.
      stop = callsLeft === 0 ? 'tool-calls' : 'rounds';
      if (call.kind === 'unparsed' || call.tool !== 'answer') {
        exchanges.push({ round: rounds, directive, result: LAST_TURN_ONLY, ok: false });
        break;
      }
      const accepted = executeTool(telemetry, call);
      if (accepted.resolved !== undefined) {
        const gated = admit(accepted.resolved);
        exchanges.push({
          round: rounds,
          directive,
          result: gated.ok ? accepted.text : gated.text,
          ok: gated.ok,
        });
        if (gated.ok) return settle('answered', accepted.resolved, 'model');
        break;
      }
      exchanges.push({ round: rounds, directive, result: accepted.text, ok: accepted.ok });
      answerRefused = accepted.text;
      break;
    }
    if (call.kind === 'unparsed') {
      exchanges.push({ round: rounds, directive, result: call.text, ok: false });
      continue;
    }
    const result = executeTool(
      telemetry,
      call,
      schedule === null ? undefined : { order: schedule, cursor },
    );
    if (result.cursor !== undefined) cursor = result.cursor;
    if (call.tool === 'answer' && result.resolved !== undefined) {
      const gated = admit(result.resolved);
      exchanges.push({
        round: rounds,
        directive,
        result: gated.ok ? result.text : gated.text,
        ok: gated.ok,
      });
      if (gated.ok) {
        return settle('answered', result.resolved, 'model');
      }
      // A refused override is NOT the end of the investigation: the model may satisfy the rule on the next turn,
      // which is the whole reason the rule is announced before it is enforced.
      continue;
    }
    exchanges.push({ round: rounds, directive, result: result.text, ok: result.ok });
    if (call.tool === 'answer') {
      answerRefused = result.text;
      continue;
    }
    toolCalls += 1;
    // The RECORD the gate reads is the executed per-service queries and nothing else: `fleet`, `services` and
    // `failed` are argument-free, and a refused call showed the model nothing it could cite. The argument IS the
    // directory key — `executeTool` resolves these three tools by exact key and `buildTelemetry` sets `id` from that
    // key — so no second lookup is needed and none is written, because a guard no case can reach is a branch that
    // reports coverage rather than correctness.
    //
    // `next` is a per-service query whose service the DIRECTIVE does not name, so the name comes from what the tool
    // served. It is recorded under the same rule as the other three: a schedule that showed the model a service is a
    // citation, and a gate that refused an answer about a scheduled service would be refusing evidence the harness
    // itself handed over.
    const served =
      call.tool === 'next'
        ? result.served
        : call.tool === 'metric' || call.tool === 'logs' || call.tool === 'edges'
          ? call.argument
          : undefined;
    if (result.ok && served !== undefined) {
      if (!cited.has(served)) {
        cited.add(served);
        investigated.push(served);
      }
    }
  }

  // The fallback, and the reason the arm is MONOTONE: a case the engine had right can only be lost by an override
  // that was ADMITTED and wrong, never by a refusal. `none` has no fallback by construction — a control that
  // answered for the model would not be the surface iteration 318 measured.
  if (policy !== 'none' && priorTop !== null) {
    return settle(stop, priorTop, 'prior');
  }
  // The control still has NO fallback: resolving the prior here would hand `none` a name the model never produced,
  // and `none` is the surface iteration 318 measured. The resolver is a second reader of a settled answer, not a
  // second way into one.
  return settle(stop, null, null);
}

/** A chat client satisfies the port without adaptation; named so the wiring states it once. */
export type ChatClientPort = ChatClient;

/** One case's row in the arm's artifact: what was asked, what the engine said, what the model said. */
export interface QueryArmRow {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  readonly engineRank: number;
  readonly engineWinner: string | null;
  /**
   * The margin the certainty guard read: the engine's own separation between the two candidates it published first.
   *
   * Recorded per row rather than recomputed, because it is the one input that decides whether the guard could speak
   * at all — a row with `null` here is a case the rule was not allowed to answer for, and an artifact without the
   * column is one whose surface the guard would have left untouched.
   */
  readonly engineMargin: number | null;
  readonly answer: string | null;
  readonly correct: boolean;
  /**
   * How the investigation ended, or `'error'` when the CALL failed.
   *
   * The distinction is not cosmetic: a transport failure and a wrong answer both leave the arm without an answer,
   * and a precision that counted the first as a break would report the endpoint's mood as the model's accuracy.
   */
  readonly stop: QueryOutcome['stop'] | 'error';
  /** The end of the investigation as it ran, so a wrong answer can be looked inside. */
  readonly trace: string;
  /**
   * Whether this case was investigated with a prior shown up front.
   *
   * Recorded per row rather than assumed from the command line, because the two arms have different FLOORS — a
   * seeded arm's floor is its seed's accuracy and a free arm's floor is the first list a tool printed — and a
   * precision that mixed the two populations would average two different measurements.
   */
  readonly seeded: boolean;
  /**
   * How many slots the schedule this arm walked had, or `null` for a free arm.
   *
   * Recorded for the reason `seeded` is: a scheduled run and a free run differ only in how the arm chose its calls,
   * and a precision that pooled them would average two different policies under one name. The width is the number
   * that matters — a schedule of five cannot spend the ten calls the budget allows.
   */
  readonly scheduled?: number | null;
  /**
   * Whether the arm had an order the gate defends and a refusal settles on, which is not the same as showing one.
   *
   * `seeded` records what the PROMPT showed; this records what the loop fell back to. On every arm before the
   * fallback existed the two were the same decision, so a row that carries only `seeded` is read that way.
   */
  readonly incumbent?: boolean;
  /**
   * The model's own answer, before any gate — what an ungated arm would have returned on this case.
   *
   * Recorded so the three gate policies are priced from ONE artifact: the online run applies the dispatched policy
   * and the other two are re-scored from these fields at no cost.
   */
  readonly rawAnswer: string | null;
  /** Who produced {@link answer}: the model, the prior the gate fell back to, or nobody. */
  readonly answeredBy: 'model' | 'prior' | 'entry' | 'interface' | 'door' | 'certainty' | null;
  /** Services the investigation executed a per-service query against, in first-query order. */
  readonly calls: readonly string[];
  /** Whether {@link rawAnswer} sits on the engine's rank-1 callee-side cone. */
  readonly inCone: boolean;
  /** The raw answer's own evidence, or `null` when the case does not carry that name. */
  readonly answerOnset: Onset | null;
  /** The prior's own evidence, or `null` when there is no prior or the case does not carry it. */
  readonly priorOnset: Onset | null;
  /** Net failures on `prior -> raw answer`, or `null` when no such interface is recorded. */
  readonly intoAnswer: number | null;
  /** Net failures on `raw answer -> prior`, or `null` when no such interface is recorded. */
  readonly intoPrior: number | null;
  /** Answers the gate refused on this case. */
  readonly gateRefusals: number;
  /** The service requests enter the system through, or `null` when the graph does not name one. */
  readonly entry: string | null;
  /** The largest error-rate rise among the entry's own callees, or `null` when it has none. */
  readonly entryChildErrors: number | null;
  /**
   * Whether a failing interface lands on a service below the entry, or `null` when the graph names no entry.
   *
   * Answer-independent, like the witness: it is a property of the CASE, so one column prices the rule for every
   * policy and for both sides of every fallback.
   */
  readonly belowFails: boolean | null;
  /**
   * The raw answer's own departure in a channel that is not an error rate.
   *
   * Recorded per SIDE rather than for the settled answer, because the artifact prices every policy from one run and
   * a policy that refuses settles on the prior instead. One field would make the two readings share a measurement
   * that belongs to only one of them.
   */
  readonly rawSurprise: number | null;
  /** The prior's own departure, on the same channel split. */
  readonly priorSurprise: number | null;
  /**
   * The caller of the strongest novel interface in this case, or `null` when it carries none.
   *
   * Recorded per CASE rather than per side, because the witness does not depend on which name the gate settled on:
   * one column pair prices the rule for every policy and for both sides of every fallback.
   */
  readonly novelCaller: string | null;
  /** That interface's novel-call count, or `null` when there is none. */
  readonly novelRise: number | null;
  readonly rounds: number;
  readonly toolCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Which post-answer reader, if any, may rename the answer.
 *
 * `none` is the arm as iterations 318–321 shipped it. `entry-prior` is {@link entryAttribution}, which runs AFTER
 * the gate settles the answer, needs no model call and no second dispatch, and is priced at zero from the artifact's
 * own rows (`summariseGatePolicies`). `edge-novel` is {@link interfaceAttribution} FIRST and then that same front
 * door rule for everything the witness does not claim — one mode rather than a flag per rule, because the two are
 * ordered deliberately: the witness names a specific interface, the prior names a whole front door, and a case
 * that has both should be decided by the narrower reading (`applyResolver` orders them, not its callers).
 */
export type Resolution = 'none' | 'entry-prior' | 'edge-novel';

/**
 * The surprise a service's own departure must stay under for the entry prior to speak.
 *
 * Chosen by five-fold cross-validation over the 1 422-case artifact: the parameter is re-picked on four folds and
 * applied to the fifth, and the plateau is flat from 300 to 750 (1 219 and 1 217 correct against `lag`'s 1 174).
 * 300 is the in-sample maximum and the value four of the five folds chose; the flatness is the reason a single
 * number is defensible here where iteration 321's four-cut margin sweep was not.
 */
export const ENTRY_PRIOR_SURPRISE = 300;

/**
 * The resource ceiling under which an answer's departure counts as "traffic only", or `null` to read no channel.
 *
 * `null` is a DECISION and not a placeholder. The bar's first pricing read 1 277 against 1 270 at one value of a
 * six-point sweep whose neighbours read 1 269 and 1 260 — a peak at one value on one corpus, which is the shape this
 * programme has refused twice. The axis therefore ships disabled until a bar chosen on one fold pays on the other,
 * in both directions, and `channel-split.ts` is the only thing that may set this constant: it is set to a number
 * only when its cross-validation report says `passes`.
 */
export const ENTRY_PRIOR_TRAFFIC_KAPPA: number | null = null;

/**
 * The error-rate rise a conduit must show before the front door may speak in its place, or `null` to read no floor.
 *
 * Iteration 329's clause, and it is a CONDITIONING of the bar above rather than a second rule: 328 measured the
 * traffic-only bar repairing `HTTPResponseReplaceCode` **20 for 20** and breaking `NetworkDelay` **15 for 15**, so
 * the axis was refused for non-identifiability rather than for its bar. The separating column is the answer's own
 * error rate — a channel that cannot say WHERE a failure is, because it rises on every hop of the path, but that can
 * say WHAT kind of failure it is: a rewritten response code fails calls, a delayed one does not.
 *
 * Read as an ABSOLUTE rise (`symptomRise`, in errors per request) rather than as a standardised surprise, because an
 * error rate is flat at zero before an injection and the standardisation refuses a zero-median pre-window — a refusal
 * that lands exactly on the cases this clause exists for.
 *
 * `null` is the disabled state and it is the shipped state until `channel-split.ts` reports `passes`.
 */
export const ENTRY_PRIOR_SYMPTOM_FLOOR: number | null = null;

/**
 * The failures on the edge into the entry above which the door answers, whatever settled the case, or `null` to
 * read no boundary at all.
 *
 * Iteration 332's rule, and it is **shipped**: a rule may ship on a held-out reading that clears the standing bar,
 * and this one cleared it on both artifacts (deltas +10 / +11 and +9 / +11, precision 0.80 and 0.76, chosen cell 50 on
 * both folds, nothing fired outside its population). 50 is the cell the two folds chose independently, not a peak
 * picked here: the sweep is flat from 50 to 100 and the neighbours read 0.81 and 0.82 precision, so the value is a
 * plateau rather than a spike.
 *
 * What it is NOT. It is not a coefficient on the entry's score — §320 of the register refused every form of that, and
 * for a measured reason (the entry sits 18–45 ranks below the winner, and a term bounded by one step cannot close a
 * thirty-rank gap). It does not touch the ranking at all: it reads the case's failure BOUNDARY — no child of the door
 * reports an error, no measured edge below the door failed, and requests failed on the way in — and when the failure
 * provably never travelled below the door it overrides the answer of every channel, including the model's.
 *
 * `null` is therefore not the shipped state but the OFF switch, and it is the ablation the user asked for: the same
 * constant, set to `null`, restores the 324–331 surface byte for byte.
 */
export const ENTRY_FIRST_HOP_BETA: number | null = 50;

/**
 * The wall a resolver uses to separate an error-rate rise from a service's own departure.
 *
 * The split is the axis this resolver reads, and since iteration 328 it lives in `channel-kind.ts` as a four-way
 * classification rather than a boolean here: `http.response.error_rate` rising means *calls are failing here*,
 * which is true of every hop on a failure's path, while `container.cpu.usage` rising means *this service is working
 * harder* — and the third and fourth kinds (traffic, and a family neither rule claims) are different statements
 * again. Re-exported from one predicate so a resolver and a census cannot disagree about what a series measures.
 *
 * @param label - The metric family as the producer wrote it.
 * @returns True when the series is a failure record.
 */
function isSymptomChannel(label: string): boolean {
  return channelKindOf(label) === 'symptom';
}

/**
 * The service requests enter the system through.
 *
 * ## Why the root is not the entry
 *
 * Every case in this corpus has one root — `loadgenerator` — and it is a **traffic generator**, not a service: it
 * measures the load it applied and nothing about the system's internals. The entry is the service it calls, and on
 * this corpus that is `ts-ui-dashboard` in 1 421 of 1 422 cases, which is also where 186 of the corpus's ground
 * truths sit.
 *
 * So the rule is structural and it fails closed twice. A root with exactly one callee is a client and the entry is
 * that callee; a root with several callees IS the entry (it is a front door in its own right, which is the one case
 * where the corpus names the dashboard as the root); and a graph with no root or with more than one has no single
 * way in, so it has no entry.
 *
 * @param telemetry - The case's tool view.
 * @returns The entry, or `null` when the graph does not name one.
 */
export function entryOf(telemetry: Telemetry): string | null {
  // The corpus's call graph is BROADER than its traffic: 14 services have no caller at all in the graph
  // (`ts-admin-*`, `rabbitmq`, `kubernetes-endpoints`), because nothing in the captured window called them. A rule
  // that demanded a single root therefore found none on any of the 1 422 cases — which is how this was found. What
  // distinguishes the way in is REACH: the front door is what the rest of the system sits behind, so the dominant
  // root is the one that reaches strictly more services than every other, and a tie means the graph has several
  // fronts and no single entry.
  let dominant: { id: string; reach: number } | null = null;
  let tied = false;
  for (const root of telemetry.services.values()) {
    if (root.callers.length > 0) continue;
    const reach = reachableFrom(telemetry, root.id).size - 1;
    if (dominant === null || reach > dominant.reach) {
      dominant = { id: root.id, reach };
      tied = false;
    } else if (reach === dominant.reach) {
      tied = true;
    }
  }
  if (dominant === null || tied || dominant.reach === 0) return null;
  const root = telemetry.services.get(dominant.id)!;
  // `reach > 0` is what makes the ternary total: a root that reaches anything has at least one callee, so there is
  // no third case for a `return null` to cover. The guard above states the condition; this line spends it.
  return root.callees.length === 1 ? root.callees[0]! : root.id;
}

/**
 * Everything reachable from one service by following callee edges, itself included.
 *
 * @param telemetry - The case's tool view.
 * @param from - The service to start at.
 * @returns The reachable set.
 */
function reachableFrom(telemetry: Telemetry, from: string): ReadonlySet<string> {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const here = queue.shift()!;
    // The assertion is the same argument `onPriorCone` makes: every node pushed below came out of a `callees` list
    // that `buildTelemetry` seeded from the same key set, so a miss here is unreachable.
    for (const next of telemetry.services.get(here)!.callees) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** What the entry prior reads about one answer. */
export interface EntryPriorEvidence {
  /** The service requests enter the system through, or `null` when the graph does not name one. */
  readonly entry: string | null;
  /**
   * The largest error-rate rise among the entry's OWN callees, or `null` when the entry has none.
   *
   * This is the quantity that says whether the failure travelled downward. A fault below the entry reaches it
   * through the callee that sits on the failed path, so that callee's error rate rises. A fault AT the entry does
   * not: the requests are sabotaged before they are ever routed, and the callees see nothing.
   */
  readonly entryChildErrors: number | null;
  /**
   * The answer's strongest departure in a channel that is not an error rate, or `null` when it has none.
   *
   * A service that is working harder carries its own signature wherever it sits. A service whose only rise is its
   * error rate is answering failures it received.
   */
  readonly answerSurprise: number | null;
  /**
   * Whether a failing interface lands on a service BELOW the entry, or `null` when the graph names no entry.
   *
   * The same premise as {@link entryChildErrors}, read on the dense channel. That field asks "did an error rate rise
   * under the door", and the corpus's error channel is silent in 1 053 of the 1 054 cases whose callee rose — so a
   * zero there is usually an ABSENT INSTRUMENT rather than a measured quiet, and a rule that reads it as the latter
   * speaks where it has no evidence. A failing interface is the statement itself: `failed − baseline > 0` on an
   * edge whose callee sits under the entry means calls BELOW the door are failing, which is the premise's
   * negation.
   *
   * It is measured on the reachable set rather than on the entry's direct callees, because the failure reaches the
   * entry through the deepest hop that actually broke and the arm answers one or two levels below the door.
   */
  readonly belowFails: boolean | null;
  /**
   * The answer's departure split by CHANNEL, or `null` when the case does not carry that service.
   *
   * {@link answerSurprise} is the largest of these three numbers, so this field is the same measurement
   * disaggregated rather than a second one. It is carried because the aggregate cannot say whether a rise of 700
   * was work the service did or a retry storm passing through it, and that difference is what decides whether a
   * deep answer is a source or a conduit — see `channel-kind.ts`.
   */
  readonly answerChannels: ChannelDeparture | null;
  /**
   * Requests that failed on the edge INTO the entry, above the pre-injection baseline, or `null` when unmeasured.
   *
   * The one column in this record that is about the boundary of the SYSTEM rather than about a service. A fault at
   * the door sabotages requests as they arrive, so that edge's failure count rises by hundreds; a fault on a leaf the
   * request path never exercised leaves it at zero, and a fault below the door raises it incidentally by a dozen.
   * Iteration 332 measured the three populations apart and priced the rule that reads this column: repairs 28 against
   * breaks 7 at a bar of 50, held out at +10 and +11 on the two folds, precision 0.80.
   */
  readonly entryInboundFails: number | null;
}

/**
 * Read what the entry prior needs about one answer.
 *
 * @param telemetry - The case's tool view.
 * @param answer - The service about to be answered with, or `null`.
 * @returns The evidence, with `null` in every field the case cannot supply.
 */
export function readEntryPrior(telemetry: Telemetry, answer: string | null): EntryPriorEvidence {
  const entry = entryOf(telemetry);
  if (entry === null)
    return {
      entry: null,
      entryChildErrors: null,
      answerSurprise: null,
      belowFails: null,
      answerChannels: null,
      entryInboundFails: null,
    };
  const entryService = telemetry.services.get(entry)!;
  let childErrors: number | null = entryService.callees.length === 0 ? null : 0;
  for (const child of entryService.callees) {
    const service = telemetry.services.get(child);
    if (service === undefined) continue;
    for (const one of service.metrics) {
      if (!isSymptomChannel(one.label)) continue;
      // A callee's rise is a RISE: a series that fell after the injection is not a symptom of having failed.
      if (one.delta > (childErrors ?? 0)) childErrors = one.delta;
    }
  }
  const service = answer === null ? undefined : telemetry.services.get(answer);
  // The floor is a MEASURED zero rather than a missing one: a service whose channels cannot be standardised has no
  // self-departure to report, and the predicate below refuses on `null` rather than reading silence as quiet.
  //
  // One read, three channels: `answerSurprise` is the largest of them, so the aggregate and the split cannot come to
  // describe different measurements — the failure a second loop would invite.
  const channels = service === undefined ? null : departureOf(service.metrics);
  let surprise: number | null = null;
  for (const value of [
    channels?.resource ?? null,
    channels?.traffic ?? null,
    channels?.other ?? null,
  ]) {
    if (value === null) continue;
    if (surprise === null || value > surprise) surprise = value;
  }
  // The dense reading of the same premise, and the one that decides it where the error channel is absent: an
  // interface that BEGAN failing under the door says the failure travelled, whatever the error rates report. The
  // entry's own inbound edges are excluded by naming the callee under it, so the front door's own failing calls are
  // the premise rather than its negation.
  const below = reachableFrom(telemetry, entry);
  let belowFails = false;
  for (const edge of telemetry.failed) {
    if (!(edge.failed - edge.baseline > 0)) continue;
    if (edge.callee === entry) continue;
    if (!below.has(edge.callee)) continue;
    belowFails = true;
    break;
  }
  // The boundary of the system, read on the same edge list the clause above walks: how many requests failed on the
  // way IN. `failed - baseline` and not `failed`, because an edge that carried errors before the injection is not
  // evidence of an injection; and a MEASURED zero when the edge did not fail, because the load generator's edge is
  // written in every case's edge list and its absence from the FAILING list is therefore a measurement.
  let inbound = 0;
  for (const edge of telemetry.failed) {
    if (edge.callee !== entry) continue;
    const rise = edge.failed - edge.baseline;
    if (rise > 0) inbound += rise;
  }
  return {
    entry,
    entryChildErrors: childErrors,
    answerSurprise: surprise,
    belowFails,
    answerChannels: channels,
    entryInboundFails: inbound,
  };
}

/**
 * What the interface channel says, in names rather than counts.
 *
 * The reading is the CALLER of the edge that carried a request shape its callee had never seen before the
 * injection, and nothing else: `(route, method)` is the callee's own record of what it was asked for, so a novel
 * shape is the caller's corruption and never the callee's break. A callee that breaks rejects nothing — it fails
 * the requests it has always served, and those are shapes it has carried for the whole pre-window.
 */
export interface InterfacePriorEvidence {
  /** The caller of the strongest novel interface, or `null` when the case carries no novelty at all. */
  readonly novelCaller: string | null;
  /** That interface's novel-call count, or `null` when there is none — the evidence's own volume. */
  readonly novelRise: number | null;
}

/** Everything the resolver reads. One object, so the loop and the pricing cannot pass different fields. */
export interface ResolverEvidence extends EntryPriorEvidence, InterfacePriorEvidence {}

/**
 * Read the strongest interface witness in a case.
 *
 * ## Why a caller and not an edge
 *
 * The corpus answers with a SERVICE, so an edge would have to become a name by a second decision — and every
 * candidate for that decision (the upstream end, the downstream end, the deeper end) is a rule wearing the
 * instrument's name. Novelty already decides the end: it charges whoever sent the shape.
 *
 * ## Why the traffic generator is not a witness
 *
 * `loadgenerator` is a ROOT of the call graph — nothing in the system calls it — which is the same structural fact
 * that makes `entryOf` read the entry as its callee. Its request shape is a workload, not a service's interface,
 * and the corpus never labels it: naming it would answer with a name no case accepts. It is the strongest witness
 * in **74 of the 203** cases that carry the channel, so this refusal is not a corner.
 *
 * ## What it does not do
 *
 * It does not look at the size of the failing edge, and that omission is the finding: `failed − baseline` is
 * identical whether the caller corrupted the request or the callee broke, and the count is what every earlier
 * version of this reading sorted by.
 *
 * @param telemetry - The case's tool view.
 * @returns The caller and volume of the strongest novel interface, or a refusal in both fields.
 */
export function readInterfacePrior(telemetry: Telemetry): InterfacePriorEvidence {
  let best: { caller: string; rise: number; failed: number; callee: string } | null = null;
  for (const edge of telemetry.failed) {
    // A zero is a refusal, not a small number: the producers that cannot measure novelty report it and the
    // pre-290 channel omits it entirely, and both mean "no finding" rather than "no novelty".
    if (!(edge.novel > 0)) continue;
    const caller = telemetry.services.get(edge.caller);
    if (caller === undefined) continue;
    if (caller.callers.length === 0) continue;
    const candidate = {
      caller: edge.caller,
      rise: edge.novel,
      failed: edge.failed,
      callee: edge.callee,
    };
    if (best === null || bestWitness(candidate, best)) best = candidate;
  }
  return best === null
    ? { novelCaller: null, novelRise: null }
    : { novelCaller: best.caller, novelRise: best.rise };
}

/**
 * Whether one witness outranks another: volume, then failure count, then the callee's name.
 *
 * The last comparison is alphabetical for the reason `bySurprise` and `byFall` both end the same way — the reading
 * must be a function of the DATA, not of the order the corpus serialised its edges in — and it is the only one that
 * can decide a case two edges tie on both counts. The corpus never needs it: no case carries two distinct novel
 * callers, so this is a total order for the type rather than a tie-break the run depends on.
 *
 * @param left - The candidate.
 * @param right - The incumbent.
 * @returns True when `left` should replace `right`.
 */
function bestWitness(
  left: { rise: number; failed: number; callee: string },
  right: { rise: number; failed: number; callee: string },
): boolean {
  if (left.rise !== right.rise) return left.rise > right.rise;
  if (left.failed !== right.failed) return left.failed > right.failed;
  return left.callee < right.callee;
}

/**
 * The interface attribution: answer with the caller whose request shape its callee had never seen.
 *
 * @param answer - The service the gate settled on, or `null`.
 * @param evidence - What {@link readInterfacePrior} read.
 * @returns The caller to answer with instead, or `null` when the rule does not fire.
 */
export function interfaceAttribution(
  answer: string | null,
  evidence: ResolverEvidence,
): string | null {
  if (answer === null) return null;
  // Narrowed by measurement rather than by truthiness, for the reason `entryAttribution` is: an artifact written
  // before this iteration carries no such columns, and `undefined !== answer` would fire on every one of its rows.
  if (typeof evidence.novelCaller !== 'string') return null;
  if (!Number.isFinite(evidence.novelRise)) return null;
  if (evidence.novelCaller === answer) return null;
  return evidence.novelCaller;
}

/**
 * The entry prior: attribute the failure to the front door when the evidence says it never went past it.
 *
 * ## What it is for
 *
 * Iteration 321's census left one number standing over everything else: of the arm's 248 misses, **180 answer a
 * service that is a TRANSITIVE CALLER of the truth**, 122 of them one hop below it, and **105 of those 122 answer a
 * callee of `ts-ui-dashboard`**. The arm does not fail to look; it looks one hop too far DOWN, every time, on a
 * corpus whose ground truth is the front door in 186 of 1 422 cases — where the engine itself is right 13 times
 * (7.0 %) against 96 % on the cases whose truth is a silent deep service.
 *
 * ## Why the two conditions are the whole test
 *
 * For the failure to have been injected at the entry, **nothing below the entry can have started failing**: the
 * sabotage is applied to the entry's own inbound API, and its callees are called normally, or not called at all.
 * For the failure to have been injected below, the path from the truth up to the entry rises, so the entry's own
 * callee on that path rises. That is `entryChildErrors` and it is asymmetric in exactly one direction.
 *
 * `answerSurprise` then removes the other half of the confusions: a **silent** deep source — 230 of the 248 misses
 * have a truth that never logs an error — still carries its own resource signature, and a service that carries one
 * is a source wherever it sits. What is left over, a service whose only rise is its error rate with nothing
 * failing beneath it, is a victim of the top.
 *
 * Both conditions are refusals when the case cannot supply them, for the reason every other predicate in this file
 * fails closed: a rule that speaks in the absence of its own input is a wider rule wearing a narrower name. The
 * first of the two is read TWICE for that reason — once in the error channel it was written against, and once in
 * the failing-interface record, which is the channel that reports a failing call rather than a rising rate.
 *
 * @param answer - The service the gate settled on, or `null`.
 * @param evidence - What {@link readEntryPrior} read, or `undefined` when the caller did not read it.
 * @param threshold - The self-departure a quiet answer must stay under; defaults to {@link ENTRY_PRIOR_SURPRISE}.
 * @returns The entry to answer with instead, or `null` when the rule does not fire.
 */
export function entryAttribution(
  answer: string | null,
  evidence: EntryPriorEvidence | undefined,
  threshold: number = ENTRY_PRIOR_SURPRISE,
  trafficKappa: number | null = ENTRY_PRIOR_TRAFFIC_KAPPA,
  symptomFloor: number | null = ENTRY_PRIOR_SYMPTOM_FLOOR,
): string | null {
  const premise = readEntryPremise(answer, evidence);
  if (premise === null) return null;
  if (premise.surprise > threshold) {
    // The extension, and it ships DISABLED: `trafficKappa === null` makes this branch the `return null` every
    // earlier iteration had. The axis is not shipped on its in-sample maximum (see `channel-split.ts` for the
    // cross-validation that decides it), so a default that fired would be a rule nobody measured.
    if (trafficKappa === null) return null;
    if (!conduitUnder(premise.channels, trafficKappa, symptomFloor)) return null;
  }
  return premise.entry;
}

/**
 * The front door's PREMISE: everything the rule must be true about before a bar is consulted.
 *
 * Split out of {@link entryAttribution} in iteration 329 for one reason: the pricing has to know which cases the rule
 * ADDRESSES before it can ask whether a bar helps them, and a pricing that restated these six clauses would be a
 * second implementation of one rule — the failure iteration 322 paid a dispatch to learn. So the population is read
 * through the same function the resolver reads.
 *
 * @param answer - The service the gate settled on, or `null`.
 * @param evidence - What {@link readEntryPrior} read, or `undefined` when the caller did not read it.
 * @returns The entry the rule would name, or `null` when the premise does not hold.
 */
export function entryPremise(
  answer: string | null,
  evidence: EntryPriorEvidence | undefined,
): string | null {
  return readEntryPremise(answer, evidence)?.entry ?? null;
}

/**
 * The first hop: when the failure provably never travelled below the door, the door is the answer.
 *
 * ## Why this is not the front door's rule again
 *
 * {@link entryAttribution} asks a question about the ANSWER — is the service you named quiet? — and it therefore
 * refuses whenever the answer is loud, which is exactly the population that holds most of the remaining misses at the
 * entry. This rule asks a question about the CASE: did any failure cross the door at all? A case whose children report
 * nothing, whose edges below the door never failed, and whose inbound edge did fail is a case where every service a
 * ranking or a model could name has no measured failure of its own — the answer is the door, and no channel can
 * improve on it.
 *
 * ## Why the three clauses are each a refusal rather than a heuristic
 *
 * 1. **A child that reports an error** says the failure travelled. `null` here is the producer's refusal, not a quiet
 *    child, so it refuses too: the corpus's error channel is absent in most cases and reading absence as zero is the
 *    mistake 326 paid for.
 * 2. **An edge below the door that failed** is the same statement on the dense channel.
 * 3. **`null` inbound** is an unmeasured boundary. The load generator's edge is written in every case of this corpus,
 *    so this refusal is about other corpora rather than this one, and it stays because a rule that fired on an
 *    unmeasured column would be a rule whose most important clause cannot be checked.
 *
 * @param answer - The service about to be answered with, or `null`.
 * @param evidence - What {@link readEntryPrior} read.
 * @param beta - The bar, or `null` to read no boundary at all.
 * @returns The entry the rule names, or `null` when it stays silent.
 */
export function doorAttribution(
  answer: string | null,
  evidence: EntryPriorEvidence | undefined,
  beta: number | null = ENTRY_FIRST_HOP_BETA,
): string | null {
  if (beta === null || evidence === undefined) return null;
  if (answer === null || evidence.entry === null) return null;
  if (answer === evidence.entry) return null;
  if (evidence.entryChildErrors !== 0) return null;
  if (evidence.belowFails !== false) return null;
  if (evidence.entryInboundFails === null) return null;
  return evidence.entryInboundFails > beta ? evidence.entry : null;
}

/** One reading of the premise, carrying the columns the bars need so they need not be re-narrowed. */
interface EntryPremiseReading {
  readonly entry: string;
  readonly surprise: number;
  readonly channels: ChannelDeparture | null;
}

/**
 * Narrow every input and decide the premise, once.
 *
 * Each field is narrowed by MEASUREMENT rather than by truthiness, because these arrive from JSON: an artifact
 * written before this iteration carries no such keys at all, and `undefined > threshold` is false — a predicate
 * written with comparisons alone would fire on every row of every older artifact and call it a result.
 *
 * @param answer - The service the gate settled on, or `null`.
 * @param evidence - What {@link readEntryPrior} read, or `undefined`.
 * @returns The reading, or `null` when the premise does not hold.
 */
function readEntryPremise(
  answer: string | null,
  evidence: EntryPriorEvidence | undefined,
): EntryPremiseReading | null {
  if (answer === null || evidence === undefined) return null;
  if (typeof evidence.entry !== 'string') return null;
  if (evidence.entry === answer) return null;
  if (!Number.isFinite(evidence.entryChildErrors)) return null;
  if (evidence.entryChildErrors! > 0) return null;
  // The premise's dense reading, and the one that overrules the sparse one: a failing interface under the door is
  // calls BELOW the door failing, which is exactly the statement the rule needs to be false. Measured on 325's
  // dispatch it keeps all 67 of the rule's repairs and refuses 7 of its 16 breaks — the largest block of harm any
  // shipped rule has caused was a CORRECT answer renamed to the front door, and those are cases where this column
  // is true.
  if (typeof evidence.belowFails !== 'boolean') return null;
  if (evidence.belowFails) return null;
  if (!Number.isFinite(evidence.answerSurprise)) return null;
  return {
    entry: evidence.entry,
    surprise: evidence.answerSurprise!,
    channels: evidence.answerChannels ?? null,
  };
}

/**
 * The engine's opinion, as the artifact recorded it: the name it placed first and the margin that separated it.
 *
 * A separate type from `QuerySeed` because the two answer different questions. A seed is *what the model was shown*
 * and is `null` on a free arm; this is *what the engine said*, which exists on every arm that was given a verdict —
 * the rule is about the engine and not about the prompt, and coupling them would make `--seeding none` silently
 * disable a guard that has nothing to do with seeding.
 */
export interface EngineOpinion {
  /** The engine's own first choice, or `null` when the verdict carried no ranking. */
  readonly top1: string | null;
  /**
   * The margin between the engine's first and second PUBLISHED candidate, or `null` when the artifact carried none.
   *
   * `null` is an unmeasured boundary and not a zero: an artifact written before the column existed must leave the
   * pipeline alone, which is the clause iteration 329 paid for.
   */
  readonly margin: number | null;
}

/**
 * The bar at which a resolver may not rename the engine's own first choice.
 *
 * One constant for the product switch and the ablation switch, as every rule in this file has: `null` restores the
 * surface of iterations 324–335 byte for byte, so a reading with the rule and a reading without it are the same
 * program on the same input.
 *
 * The value is the middle of the measured plateau rather than its edge: on the shipped surface the guard repairs
 * 20 of 1 422 cases at every bar in **[1.0, 2.0]** with **zero** breaks, so 1.5 is a choice inside a plateau and not
 * a point on its slope (`docs/engine-certainty-336.md`).
 */
export const ENGINE_CERTAINTY_MARGIN: number | null = 1.5;

/**
 * The engine's opinion, taken from a verdict row's own two columns.
 *
 * One owner for the derivation, because the sign is not obvious: the columns describe the pair the row PUBLISHED, and
 * the engine's order is not a function of its scores, so a negative margin is a real configuration rather than a
 * corrupt row. A reader that clamped it to zero would report a decided engine on the cases where the placement passes
 * had overturned the arithmetic — the exact population this guard exists to leave alone.
 *
 * @param row - A verdict row: its first name and the two sort values, each optional because an older row lacks them.
 * @returns The opinion, with an unmeasured margin as `null` rather than as a zero.
 */
export function engineOpinionOf(row: {
  readonly winner: string | null;
  readonly top1Score?: number | null | undefined;
  readonly top2Score?: number | null | undefined;
}): EngineOpinion {
  const first = row.top1Score;
  const second = row.top2Score;
  const measured =
    typeof first === 'number' &&
    typeof second === 'number' &&
    Number.isFinite(first) &&
    Number.isFinite(second);
  return { top1: row.winner, margin: measured ? first - second : null };
}

/**
 * The engine-certainty guard: a case whose engine was decided keeps the engine's answer.
 *
 * Iteration 331 refuted the guard that read the ANSWER's loudness — that quantity is the resolver's own premise read
 * backwards, so the two rules cannot both hold on a case. This one reads the engine's own separation, which is
 * independent of the answer, and iteration 334 measured where the resolver's harm lives: **12 of 81** overrides wrong
 * with a median margin of 3.34, against 0.03 on the 69 it got right.
 *
 * @param answer - What the pipeline would ship, after every rule that precedes this one.
 * @param engine - The engine's opinion, or `null` when the arm was handed none.
 * @param bar - The margin at which the engine is treated as decided; `null` disables the guard.
 * @returns The engine's first choice when the guard fires, or `null` when it does not.
 */
export function engineCertainty(
  answer: string | null,
  engine: EngineOpinion | null,
  bar: number | null = ENGINE_CERTAINTY_MARGIN,
): string | null {
  if (bar === null || engine === null || answer === null) return null;
  if (engine.top1 === null || engine.top1 === answer) return null;
  // Narrowed by measurement rather than by truthiness: `null` and a `NaN` are both unmeasured, and a comparison
  // alone would treat the first as inert and the second as decided (`NaN > 1.5` is false, `!(NaN <= 1.5)` is true).
  if (!Number.isFinite(engine.margin)) return null;
  if (engine.margin! <= bar) return null;
  return engine.top1;
}

/**
 * Apply the resolver to one settled answer.
 *
 * One function for the loop and for the pricing, for the reason iteration 322 learned at the cost of a dispatch:
 * a rule that is priced by one implementation and shipped by another is two rules, and the artifact measures the
 * one nobody runs. Iteration 323 added a second rule here and refuted it — a service that lost traffic lost it in
 * every case, so the rule localised nothing — and the refutation is in the register rather than in this function.
 *
 * @param answer - The answer the gate settled on.
 * @param evidence - The evidence read about it.
 * @param mode - Whether the rule is switched on.
 * @returns The answer to publish and the rule that renamed it, or the input and `null`.
 */
export function applyResolver(
  answer: string | null,
  evidence: ResolverEvidence,
  mode: Resolution,
  engine: EngineOpinion | null = null,
  bar: number | null = ENGINE_CERTAINTY_MARGIN,
): { answer: string | null; by: 'entry' | 'interface' | 'door' | 'certainty' | null } {
  if (answer === null || mode === 'none') return { answer, by: null };
  // The order is part of the rule, not of the caller: the witness names one interface and the prior names the whole
  // front door, so a case that carries both is decided by the narrower reading. Written here because a pricing that
  // ordered them differently from the loop would report a rule nobody runs — the failure iteration 322 paid for.
  const witnessed = mode === 'edge-novel' ? interfaceAttribution(answer, evidence) : null;
  const to = witnessed ?? entryAttribution(answer, evidence);
  const settled = to === null ? answer : to;
  // The boundary rule is applied LAST and over whatever the two resolvers settled on, because its statement is about
  // the case rather than about the answer: when the failure never crossed the door, no rename below it can be an
  // improvement. It is inside this function rather than at the call site for the reason 322 paid for — a rule wired
  // into one exit is a rule the next exit forgets.
  const door = doorAttribution(settled, evidence);
  // The engine guard is applied LAST, over what the pipeline would actually ship, because its statement is about the
  // ENGINE and not about which rule spoke: it asks whether the engine was decided, so it has to see the name that
  // would have been published. Placed before the door it would be priced on a pipeline nobody runs — the ordering
  // defect iteration 322 paid for once already.
  const guarded = engineCertainty(door ?? settled, engine, bar);
  if (guarded !== null) return { answer: guarded, by: 'certainty' };
  if (door !== null) return { answer: door, by: 'door' };
  if (witnessed !== null) return { answer: witnessed, by: 'interface' };
  return to === null ? { answer, by: null } : { answer: to, by: 'entry' };
}

/** The arm's reading. Repairs and breaks decide it; the engine's own score is the paired baseline. */
export interface QueryArmSummary {
  readonly cases: number;
  readonly answered: number;
  readonly agentCorrect: number;
  readonly engineCorrect: number;
  /** Cases the model moved from wrong to right. */
  readonly repairs: number;
  /** Cases the model moved from right to wrong. */
  readonly breaks: number;
  /** Cases the arm could not measure at all, reported rather than scored. */
  readonly failed: number;
  /** `repairs / (repairs + breaks)`, or `null` when the arm changed nothing. */
  readonly precision: number | null;
  /** Cases the engine already had right — the population a seeded arm must not lose. */
  readonly engineHits: number;
  /** Of those, the ones the arm kept. */
  readonly engineHitsRetained: number;
  /**
   * `engineHitsRetained / engineHits`, or `null` when the sample carried none.
   *
   * The complement of precision, and the number a seeded arm's floor is stated against: a seeded arm that reads
   * 0.475 precision and 1.000 retention has made edits that pay for themselves, and one that reads 0.475 precision
   * and 0.86 retention has lost more than it found.
   */
  readonly retention: number | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Score the arm.
 *
 * The two numbers that matter are stated against the ENGINE on the SAME cases rather than against the corpus: an
 * arm that reads 60 % on a sample drawn half from the engine's misses has not been measured against 83.40 %, and
 * only the paired reading says which cases moved.
 *
 * @param rows - The artifact's rows.
 * @returns The reading.
 */
export function summariseQueryArm(rows: readonly QueryArmRow[]): QueryArmSummary {
  // A case the arm could not measure is REPORTED and not scored. Folding a 401 into "the engine was right and the
  // arm was wrong" would put the endpoint's availability in a precision, which is the class of error the
  // `unauditable` count exists to prevent elsewhere in this repository.
  const measured = rows.filter((row) => row.stop !== 'error');
  const answered = measured.filter((row) => row.answer !== null).length;
  const agentCorrect = measured.filter((row) => row.correct).length;
  const engineCorrect = measured.filter((row) => row.engineRank === 1).length;
  const repairs = measured.filter((row) => row.correct && row.engineRank !== 1).length;
  const breaks = measured.filter((row) => !row.correct && row.engineRank === 1).length;
  const decided = repairs + breaks;
  const engineHits = measured.filter((row) => row.engineRank === 1).length;
  const engineHitsRetained = measured.filter((row) => row.engineRank === 1 && row.correct).length;
  return {
    cases: measured.length,
    answered,
    agentCorrect,
    engineCorrect,
    repairs,
    breaks,
    failed: rows.length - measured.length,
    precision: decided === 0 ? null : repairs / decided,
    engineHits,
    engineHitsRetained,
    retention: engineHits === 0 ? null : engineHitsRetained / engineHits,
    promptTokens: measured.reduce((sum, row) => sum + row.promptTokens, 0),
    completionTokens: measured.reduce((sum, row) => sum + row.completionTokens, 0),
  };
}

/**
 * One gate policy's reading, re-scored from the artifact rather than from a run.
 *
 * `correct` is the sample's Top@1 under the policy, which is the number a corpus score is made of; `precision` is
 * the exchange rate of the edits the policy ADMITTED, which is the number that says whether gating selects.
 */
export interface GateReading {
  readonly policy: GatePolicy;
  /** Overrides the policy let stand. */
  readonly admitted: number;
  /** Overrides the policy refused, and which therefore fell back to the prior. */
  readonly refused: number;
  /** Admitted overrides the engine had wrong — the gain. */
  readonly repairs: number;
  /** Admitted overrides the engine had right — the loss. */
  readonly breaks: number;
  /** `repairs / (repairs + breaks)`, or `null` when the policy admitted nothing decided. */
  readonly precision: number | null;
  /** Top@1 on the sample under this policy. */
  readonly correct: number;
  /** Of the engine's own hits, the share the policy keeps. */
  readonly retention: number | null;
  /** Top@1 under this policy with the entry prior applied to its own settled answer. */
  readonly correctResolved: number;
  /** Settled answers the entry prior renamed. */
  readonly resolved: number;
}

/**
 * The sentence a gate table needs when the artifact it was re-scored from cannot execute the policy it prices.
 *
 * {@link summariseGatePolicies} charges a refusal with the PRIOR — `row.engineWinner` — because that is what the
 * loop answers with when its gate refuses an override. That equivalence holds only for a SEEDED arm: the seed is
 * both the order the model is shown and the name a refusal falls back to. On a free arm there is no prior, so the
 * gate never refuses anything (`gateRefusals` sums to 0 on all 1 422 rows of run `44909105091`) and every `correct`
 * and `top1@resolved` column describes a policy the run could not have executed — computed from the artifact, but
 * not measurable by it.
 *
 * Iteration 325 dispatched that arm by accident (the `query_seed` input was omitted) and its table was read as if
 * the columns were comparable. Printing the caveat beside the table is cheaper than remembering not to believe it.
 *
 * @param rows - The artifact's rows.
 * @returns A caveat to print, or `null` when the artifact is seeded (or carries no rows at all).
 */
export function gateTableCaveat(
  rows: readonly Pick<QueryArmRow, 'seeded' | 'incumbent'>[],
): string | null {
  if (rows.length === 0) return null;
  // ANY row with no incumbent, not "no row with one": a MIXED artifact is the worse case, because a reader sees
  // refusals in the total and concludes the fallback was available on every row it is averaged over. A row written
  // before the fallback existed carries `seeded` alone, and on those artifacts showing an order and falling back to
  // it were one decision — so that column is the incumbent's reading there, exactly.
  if (rows.every((row) => row.incumbent ?? row.seeded)) return null;
  return (
    'this artifact carries rows with NO incumbent: the loop had no prior to defend, so the refused columns ' +
    'describe a policy it could not execute (gate refusals 0 by construction, not by measurement)'
  );
}

/**
 * Price every gate policy from one artifact.
 *
 * The five policies differ in exactly one place — whether an override stands — so they are a re-score of the same
 * rows and not five purchases. The control is scored at the model's own answer with **no** fallback, because that
 * is the surface iteration 318 measured; the gated policies fall back to the prior, because that is what the runner
 * does. A case the arm could not measure is out of the population for every policy, as in {@link summariseQueryArm}.
 *
 * @param rows - The artifact's rows.
 * @param resolution - Which resolver to price beside each policy; defaults to the one 322 shipped.
 * @returns One reading per policy, in the order `none`, `cited`, `cone`, `contrast`, `lag`.
 */
export function summariseGatePolicies(
  rows: readonly QueryArmRow[],
  resolution: Resolution = 'entry-prior',
): readonly GateReading[] {
  const measured = rows.filter((row) => row.stop !== 'error');
  const engineHits = measured.filter((row) => row.engineRank === 1).length;
  // Ordered by STRICTNESS, so the table reads as a ladder: each policy refuses everything the one before it refuses.
  const policies: readonly GatePolicy[] = ['none', 'cited', 'cone', 'contrast', 'lag'];
  return policies.map((policy) => {
    let admitted = 0;
    let refused = 0;
    let repairs = 0;
    let breaks = 0;
    let correct = 0;
    let retained = 0;
    let correctResolved = 0;
    let resolved = 0;
    for (const row of measured) {
      const override = row.rawAnswer !== null && row.rawAnswer !== row.engineWinner;
      const stands =
        !override ||
        gateAdmits(policy, row.rawAnswer!, {
          priorTop: row.engineWinner,
          cited: new Set(row.calls),
          onCone: row.inCone,
          evidence: {
            answer: row.answerOnset ?? undefined,
            prior: row.priorOnset ?? undefined,
            intoAnswer: row.intoAnswer,
            intoPrior: row.intoPrior,
          },
        });
      if (override && stands) admitted += 1;
      if (override && !stands) refused += 1;
      // An ADMITTED override answers with the model's own name. A refused one — and, under a gated policy, a case
      // the model never answered at all — falls back to the prior, which is what makes the arm monotone rather than
      // merely selective. The control has no fallback by construction: a control that answered for the model would
      // not be the surface iteration 318 measured.
      const standing = override && !stands ? null : row.rawAnswer;
      const effective = standing ?? (policy === 'none' ? null : row.engineWinner);
      const hit = effective !== null && row.truth.includes(effective);
      if (hit) {
        correct += 1;
        if (row.engineRank === 1) retained += 1;
        if (row.engineRank !== 1) repairs += 1;
      } else if (override && stands && row.engineRank === 1) {
        breaks += 1;
      }
      // The resolver is priced on the SAME rows, from the same artifact, at zero cost: it is a second reader of an
      // answer that is already settled, so a dispatch that measured a policy also measured what this rule would do
      // with that policy's answers. It goes through `applyResolver`, the function the LOOP calls, so the two columns
      // cannot come to describe different rules.
      const resolvedHere = applyResolver(
        effective,
        {
          entry: row.entry,
          entryChildErrors: row.entryChildErrors,
          belowFails: row.belowFails,
          answerSurprise: effective === row.rawAnswer ? row.rawSurprise : row.priorSurprise,
          // The artifact carries no channel split: the axis is priced from a corpus walk (`channel-split.ts`), and a
          // `null` here is the same refusal a case without that service would produce.
          answerChannels: null,
          // The first hop's column is not in an answer artifact; `first-hop.ts` prices that rule from the failing-edge
          // file the corpus walk writes, and a `null` here refuses rather than fires.
          entryInboundFails: null,
          novelCaller: row.novelCaller,
          novelRise: row.novelRise,
        },
        resolution,
      );
      const settledAnswer = resolvedHere.answer;
      if (resolvedHere.by !== null) resolved += 1;
      if (settledAnswer !== null && row.truth.includes(settledAnswer)) correctResolved += 1;
    }
    const decided = repairs + breaks;
    return {
      policy,
      admitted,
      refused,
      repairs,
      breaks,
      precision: decided === 0 ? null : repairs / decided,
      correct,
      retention: engineHits === 0 ? null : retained / engineHits,
      correctResolved,
      resolved,
    };
  });
}

/**
 * What one reading would do on the corpus it ships in, from the sample it was measured on.
 *
 * ## The mistake this function exists to make impossible
 *
 * The arm is measured on a sample drawn **half from the engine's misses and half from its hits**, because the two
 * quantities that decide it are repairs and breaks and a sample drawn from the misses alone has no denominator for
 * precision. That construction is a diagnostic, not a population: on this corpus 81.3 % of cases are hits the engine
 * already had right, so an edit that breaks one costs exactly what a repair gains, and there are 4.3 times as many
 * opportunities to break.
 *
 * Iteration 320 read **+7** on its sample and reported it as a gain. Projected here, the same exchange rates read
 * **−21 cases**, because 4 breaks per 80 hits is 57.8 breaks against 1 156, while 11 repairs per 80 misses is only
 * 36.6 against 266. Neither number is wrong; the sample's is the exchange rate and the corpus's is the effect. A
 * table that printed the first without the second invited the reading that had to be withdrawn.
 *
 * The projection is a **rate transfer**, not an estimate with an interval: it assumes the per-stratum rates hold on
 * the corpus, which the full-corpus run is what tests. Its honesty is in the nulls — a stratum the sample did not
 * carry has no rate, and inventing zero there would report the sample's composition as a property of the gate.
 *
 * @param reading - One policy's reading on the sample.
 * @param sampledMisses - Cases the sample drew from the engine's misses.
 * @param sampledHits - Cases the sample drew from the engine's hits.
 * @param corpus - The population the arm ships on, by stratum.
 * @returns The projected repairs, breaks, net change and resulting Top@1, or nulls when a stratum is absent.
 */
export function projectOntoCorpus(
  reading: GateReading,
  sampledMisses: number,
  sampledHits: number,
  corpus: { readonly misses: number; readonly hits: number },
): {
  readonly repairs: number | null;
  readonly breaks: number | null;
  readonly net: number | null;
  readonly top1: number | null;
} {
  const total = corpus.misses + corpus.hits;
  if (sampledMisses <= 0 || sampledHits <= 0 || total <= 0) {
    return { repairs: null, breaks: null, net: null, top1: null };
  }
  const repairs = (reading.repairs / sampledMisses) * corpus.misses;
  const breaks = (reading.breaks / sampledHits) * corpus.hits;
  const net = repairs - breaks;
  return { repairs, breaks, net, top1: ((corpus.hits + net) / total) * 100 };
}

/**
 * Every `stride`-th member of a sorted population, so a sample is reproducible without a random seed.
 * A seeded RNG would also be reproducible, and it would additionally make the sample a different one whenever the
 * population order changed. The stride is a deterministic function of the sorted population and nothing else, so
 * two runs that name the same size measure the same cases.
 *
 * @param population - Identifiers, sorted.
 * @param size - How many to take; the whole population when it is no larger.
 * @returns The sample.
 */
export function stride(population: readonly string[], size: number): string[] {
  if (size <= 0) return [];
  if (population.length <= size) return [...population];
  const step = population.length / size;
  const picked: string[] = [];
  for (let index = 0; index < size; index += 1) picked.push(population[Math.floor(index * step)]!);
  return picked;
}
