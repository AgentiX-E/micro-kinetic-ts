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
   * The peak in units of the pre-window's OWN spread — `(peak − median) / σ̂`, with `σ̂ = 1.4826 · MAD`.
   *
   * The ratio compares a rise to a LEVEL, so it rewards whatever was already large, and a series that has never
   * moved by more than a rounding error looks calm until the moment it matters. On this corpus the two statistics
   * are not two opinions about the same thing: ranked by ratio, a fleet of eight carries the truth on **74.3 %** of
   * cases; ranked by this, **84.9 %** — and on the 159 cases the engine itself misses, **25.8 %** against
   * **69.2 %**. Reach is what a candidate LIST is for, so the list is ordered by this.
   *
   * `undefined` when the pre-window holds fewer than three samples, because a spread cannot be estimated from two
   * of anything and a fabricated one would rank a series on a number the case never carried.
   */
  readonly surprise?: number;
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
  const scale = Math.abs(baseline);
  return {
    label,
    baseline,
    peak: resolvedPeak,
    delta: resolvedPeak - baseline,
    ratio: scale > 0 ? resolvedPeak / scale : resolvedPeak,
    surprise: surpriseOf(pre, resolvedPeak),
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
 * The floor on the spread is a thousandth of the level rather than zero, and it is a decision with a cost that is
 * measured rather than hoped for. A perfectly flat series would divide by zero; flooring at zero-width instead
 * would let it win on any numeric noise at all. At a thousandth of the level, a series that never moved still
 * outranks a volatile one after a one-percent step — which is why this statistic is used to ORDER A LIST and not to
 * pick its first element: as a top-1 read it is worse than the ratio (25.0 % against 30.6 % on the sample), and as
 * a top-8 read it is much better.
 *
 * @param pre - The samples before the injection, in time order.
 * @param peak - The largest sample at or after it.
 * @returns The surprise, or `undefined` when the pre-window cannot support an estimate.
 */
export function surpriseOf(pre: readonly number[], peak: number): number | undefined {
  if (pre.length < 3) return undefined;
  const mid = median(pre);
  const mad = median(pre.map((value) => Math.abs(value - mid)));
  const floor = Math.max(Math.abs(mid) * 1e-3, 1e-9);
  return (peak - mid) / Math.max(1.4826 * mad, floor);
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
    const argumentFree = name === 'services' || name === 'failed' || name === 'fleet';
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
function renderMetricLine(id: string, one: TelemetryMetric): string {
  const z = one.surprise === undefined ? 'n/a' : formatNumber(one.surprise);
  return (
    `${id} ${one.label}: base=${formatNumber(one.baseline)} peak=${formatNumber(one.peak)} ` +
    `delta=${formatNumber(one.delta)} ratio=${formatNumber(one.ratio)} z=${z} ` +
    `at=${Math.round(one.peakOffset / 1000)}s`
  );
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
 * Execute one directive against the telemetry.
 *
 * @param telemetry - The case's tool view.
 * @param call - The parsed directive.
 * @returns The text the model is shown next, and whether that text answers the question.
 */
export function executeTool(telemetry: Telemetry, call: ParsedCall): ToolResult {
  if (call.kind === 'unparsed') {
    return {
      ok: false,
      text: 'refused: a directive must be one line, `TOOL <name> [argument]` or `ANSWER <service>`',
    };
  }
  const { tool, argument } = call;
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
    // seriously. So this reads each service's WORST delta rather than the delta of its best ratio.
    const collapses: { id: string; metric: TelemetryMetric }[] = [];
    for (const [id, service] of telemetry.services) {
      let worst: TelemetryMetric | undefined;
      for (const one of service.metrics) {
        if (one.delta < 0 && (worst === undefined || one.delta < worst.delta)) worst = one;
      }
      if (worst !== undefined) collapses.push({ id, metric: worst });
    }
    const falls = collapses
      .sort((a, b) => a.metric.delta - b.metric.delta)
      .slice(0, COLLAPSE_LINES);
    const lines = [`fleet: ${entries.length} services with metrics, ${rises.length} largest rises`];
    for (const entry of rises) lines.push(`  ${renderMetricLine(entry.id, entry.metric)}`);
    if (falls.length > 0) {
      lines.push(`falling: ${falls.length} of ${entries.length} services`);
      for (const entry of falls) lines.push(`  ${renderMetricLine(entry.id, entry.metric)}`);
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
            `${edge.callee} <- ${edge.caller} net=${edge.net} failed=${edge.failed} pre=${edge.baseline}`,
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
      .filter((one) => one.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, COLLAPSE_LINES)
      .map((one) => renderMetricLine(service.id, one));
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
  /** The service the model named, or `null` when it never named one this case carries. */
  readonly answer: string | null;
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
 * Render the prior for a prompt.
 *
 * Three properties, each asserted rather than assumed:
 *
 * * **A name the case does not carry is dropped, not printed.** A prior quoting a service no tool can describe is
 *   evidence the model cannot check, and an answer to it would be refused at the terminal step anyway.
 * * **The numbering restarts after a drop**, so a gap in the list cannot be read as a rank the harness withheld.
 * * **The block says what it is.** A prior presented as an answer is a copy with extra steps, which is the exact
 *   failure the two earlier readings measured; the sentence that calls it a prior is the whole difference.
 *
 * @param seed - The order.
 * @param telemetry - The case, for the existence test.
 * @returns The block, or `''` when nothing survives — an empty prior teaches the model nothing and costs a prompt.
 */
export function renderSeed(seed: QuerySeed, telemetry: Telemetry): string {
  const kept: string[] = [];
  for (const name of seed.candidates) {
    if (name === '') continue;
    if (!telemetry.services.has(name)) continue;
    if (kept.includes(name)) continue;
    kept.push(name);
  }
  if (kept.length === 0) return '';
  const lines = [
    `The ${seed.source} order, strongest first. This is a PRIOR, not an answer — the engine is wrong on some cases,`,
    'and evidence that contradicts it is the reason to investigate.',
  ];
  for (const [index, name] of kept.entries()) lines.push(`  ${index + 1}. ${name}`);
  return lines.join('\n');
}

/** The per-case question. */
export function buildUserPrompt(
  telemetry: Telemetry,
  exchanges: readonly QueryExchange[],
  state?: BudgetState,
  seed?: QuerySeed | null,
): string {
  const names = [...telemetry.services.keys()].sort();
  const head = [
    `Incident: a fault was injected at t=0. This case carries ${names.length} services.`,
    'Deliverable: one `ANSWER <service>` line.',
  ];
  if (state !== undefined) head.push(renderBudget(state));
  if (seed !== undefined && seed !== null) {
    const prior = renderSeed(seed, telemetry);
    if (prior !== '') head.push('', prior);
  }
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
 * @param client - The model.
 * @param telemetry - The case's tool view.
 * @param budget - Rounds, calls and transcript size.
 * @param seed - An order to show the model before it investigates, or `null` for a free arm.
 * @returns The answer, the transcript, and what the arm spent.
 */
export async function runQueryAgent(
  client: QueryAgentClient,
  telemetry: Telemetry,
  budget: QueryBudget = DEFAULT_QUERY_BUDGET,
  seed: QuerySeed | null = null,
): Promise<QueryOutcome> {
  const exchanges: QueryExchange[] = [];
  let rounds = 0;
  let toolCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let answerRefused: string | null = null;
  let stop: QueryOutcome['stop'] = 'rounds';

  const settle = (stop: QueryOutcome['stop'], answer: string | null): QueryOutcome => ({
    answer,
    answerRefused,
    exchanges,
    trace: renderTranscript(exchanges, { ...budget, transcriptChars: TRACE_CHARS }),
    rounds,
    toolCalls,
    promptTokens,
    completionTokens,
    stop,
  });

  while (rounds < budget.maxRounds) {
    rounds += 1;
    const callsLeft = Math.max(0, budget.maxToolCalls - toolCalls);
    // Two ways to be out of runway: the rounds, or the calls. Either one turns this turn into the turn where the
    // only thing worth saying is the answer, and both are ANNOUNCED in the prompt that asks for it.
    const forcing = rounds === budget.maxRounds || callsLeft === 0;
    const completion = await client.complete({
      system: QUERY_SYSTEM_PROMPT,
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
      exchanges.push({ round: rounds, directive, result: accepted.text, ok: accepted.ok });
      if (accepted.resolved !== undefined) return settle('answered', accepted.resolved);
      answerRefused = accepted.text;
      break;
    }
    if (call.kind === 'unparsed') {
      exchanges.push({ round: rounds, directive, result: call.text, ok: false });
      continue;
    }
    const result = executeTool(telemetry, call);
    exchanges.push({ round: rounds, directive, result: result.text, ok: result.ok });
    if (call.tool === 'answer') {
      if (result.resolved !== undefined) return settle('answered', result.resolved);
      answerRefused = result.text;
      continue;
    }
    toolCalls += 1;
  }

  return settle(stop, null);
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
  readonly rounds: number;
  readonly toolCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
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
 * Every `stride`-th member of a sorted population, so a sample is reproducible without a random seed.
 *
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
