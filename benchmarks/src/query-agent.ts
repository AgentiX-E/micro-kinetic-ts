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

/** The longest message fragment a log line may contribute to a prompt. */
const MESSAGE_CHARS = 140;

/** The names a directive may use. One list, so the prompt and the dispatcher cannot disagree. */
export const QUERY_TOOLS = ['services', 'metric', 'logs', 'edges', 'failed', 'answer'] as const;

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
    peakOffset: peakAt - injectTime,
  };
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
    const out = callees.get(edge.from);
    if (out !== undefined && !out.includes(edge.to)) out.push(edge.to);
    const into = callers.get(edge.to);
    if (into !== undefined && !into.includes(edge.from)) into.push(edge.from);
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
    const argumentFree = name === 'services' || name === 'failed';
    if (argumentFree && argument !== '') return { kind: 'unparsed', text: line };
    if (!argumentFree && argument === '') return { kind: 'unparsed', text: line };
    return { kind: 'tool', tool: name as QueryTool, argument };
  }
  return { kind: 'unparsed', text: reply.trim().slice(0, 200) };
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
    const ranked = [...service.metrics].sort((a, b) => b.ratio - a.ratio).slice(0, METRIC_LINES);
    return {
      ok: true,
      text: ranked
        .map(
          (one) =>
            `${service.id} ${one.label}: base=${formatNumber(one.baseline)} peak=${formatNumber(one.peak)} ` +
            `delta=${formatNumber(one.delta)} ratio=${formatNumber(one.ratio)} ` +
            `at=${Math.round(one.peakOffset / 1000)}s`,
        )
        .join('\n'),
    };
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
  "  TOOL metric <service>    that service's strongest metric rises against its own pre-injection baseline",
  "  TOOL logs <service>      that service's ERROR/FATAL lines after the injection",
  "  TOOL edges <service>     that service's callers, callees, and the latency on those edges",
  '  TOOL failed              interfaces that failed during the fault, by callee',
  '  ANSWER <service>         your final answer, naming one service from `TOOL services`',
  '',
  'Rules: one directive per reply, with no text before it. You have a small budget, so query what decides the',
  'answer. `at=` and `first at +` are seconds relative to the injection; a negative offset precedes it.',
].join('\n');

/** One exchange: the directive, and the text it produced. */
export interface QueryExchange {
  readonly round: number;
  readonly directive: string;
  readonly result: string;
  readonly ok: boolean;
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

/** What one case's investigation produced. */
export interface QueryOutcome {
  /** The service the model named, or `null` when it never named one this case carries. */
  readonly answer: string | null;
  /** Why the last answer was refused, when one was. */
  readonly answerRefused: string | null;
  readonly exchanges: readonly QueryExchange[];
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

/** The per-case question. */
export function buildUserPrompt(telemetry: Telemetry, exchanges: readonly QueryExchange[]): string {
  const names = [...telemetry.services.keys()].sort();
  const head = [
    `Incident: a fault was injected at t=0. This case carries ${names.length} services.`,
    'Deliverable: one `ANSWER <service>` line.',
  ].join('\n');
  const transcript = renderTranscript(exchanges);
  return transcript === '' ? `${head}\n\nNo queries yet.` : `${head}\n\n${transcript}`;
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

/**
 * Investigate one case.
 *
 * @param client - The model.
 * @param telemetry - The case's tool view.
 * @param budget - Rounds, calls and transcript size.
 * @returns The answer, the transcript, and what the arm spent.
 */
export async function runQueryAgent(
  client: QueryAgentClient,
  telemetry: Telemetry,
  budget: QueryBudget = DEFAULT_QUERY_BUDGET,
): Promise<QueryOutcome> {
  const exchanges: QueryExchange[] = [];
  let rounds = 0;
  let toolCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let answerRefused: string | null = null;

  const settle = (stop: QueryOutcome['stop'], answer: string | null): QueryOutcome => ({
    answer,
    answerRefused,
    exchanges,
    rounds,
    toolCalls,
    promptTokens,
    completionTokens,
    stop,
  });

  while (rounds < budget.maxRounds) {
    rounds += 1;
    const completion = await client.complete({
      system: QUERY_SYSTEM_PROMPT,
      user: buildUserPrompt(telemetry, exchanges),
    });
    promptTokens += completion.promptTokens;
    completionTokens += completion.completionTokens;
    const call = parseCall(completion.text);
    const directive =
      call.kind === 'unparsed'
        ? `UNPARSED: ${call.text.slice(0, 80)}`
        : `TOOL ${call.tool}${call.argument === '' ? '' : ` ${call.argument}`}`;
    if (call.kind === 'unparsed') {
      exchanges.push({ round: rounds, directive, result: call.text, ok: false });
      continue;
    }
    if (call.tool !== 'answer' && toolCalls >= budget.maxToolCalls) {
      exchanges.push({ round: rounds, directive, result: 'budget: no tool calls left', ok: false });
      return settle('tool-calls', null);
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

  return settle('rounds', null);
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
  return {
    cases: measured.length,
    answered,
    agentCorrect,
    engineCorrect,
    repairs,
    breaks,
    failed: rows.length - measured.length,
    precision: decided === 0 ? null : repairs / decided,
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
