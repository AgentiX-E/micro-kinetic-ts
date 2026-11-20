/**
 * Run the free-investigation arm over a corpus and score it against the engine.
 *
 * The arm is measured on a SAMPLE, and the sample is stated by the command line rather than discovered: a free
 * investigation costs roughly six rounds per case, so a full 1 422-case pass is a different purchase from a
 * 200-case one, and a document that reported the first while having paid for the second would be wrong about its
 * own cost. Two strata are sampled — cases the engine has wrong and cases it has right — because the two
 * quantities that decide the arm are REPAIRS and BREAKS, and a sample drawn only from the misses would report a
 * precision with no denominator.
 *
 * Every number this prints is computed from the artifact it writes, so the reading can be re-derived.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { FSE26Loader } from '../../packages/kinetic/src/benchmarks/index.js';
import { discoverCaseDirs } from './case-discovery.js';
import { CHAT_KEY_VARIABLE, createChatClient } from './chat-completions.js';
import {
  DEFAULT_QUERY_BUDGET,
  buildTelemetry,
  netBetween,
  onPriorCone,
  onsetOf,
  projectOntoCorpus,
  runQueryAgent,
  stride,
  summariseGatePolicies,
  summariseQueryArm,
  type GatePolicy,
  type QueryArmRow,
  type QueryBudget,
  type QueryOutcome,
  type QuerySeed,
} from './query-agent.js';

/** Declared prices, per million tokens, in CNY. Estimates: the arm's own report carries the token counts. */
const PRICES = { promptPerMillion: 2, completionPerMillion: 8 } as const;

/** The command line. */
interface Args {
  readonly dataDir: string;
  readonly verdicts: string;
  readonly out: string;
  readonly model: string;
  readonly misses: number;
  readonly correct: number;
  readonly concurrency: number;
  readonly budget: QueryBudget;
  /** `none` for the free arm, `engine` to show the engine's own order before the first turn. */
  readonly seed: 'none' | 'engine';
  /** What an override must show before it replaces the prior. `none` is the ungated control. */
  readonly gate: GatePolicy;
}

/** Read the flags this runner accepts, refusing an unknown one rather than ignoring it. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const number = (name: string, fallback: number): number => {
    const raw = map.get(name);
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`--${name} must be a non-negative number`);
    return value;
  };
  const seed = map.get('seed') ?? 'none';
  if (seed !== 'none' && seed !== 'engine') throw new Error('--seed must be `none` or `engine`');
  // A gate is a policy a run states, and an unknown one is refused rather than defaulted: a typo that silently
  // measured the ungated control would publish a gated reading that no gate produced.
  const gate = map.get('gate') ?? 'none';
  const gates: readonly GatePolicy[] = ['none', 'cited', 'cone', 'contrast', 'lag'];
  if (!gates.includes(gate as GatePolicy)) {
    throw new Error('--gate must be `none`, `cited`, `cone`, `contrast` or `lag`');
  }
  const dataDir = map.get('data-dir') ?? '';
  const verdicts = map.get('verdicts') ?? '';
  const out = map.get('out') ?? '';
  if (dataDir === '' || verdicts === '' || out === '') {
    throw new Error('--data-dir, --verdicts and --out are required');
  }
  return {
    dataDir,
    verdicts,
    out,
    model: map.get('model') ?? 'deepseek-chat',
    misses: number('sample-misses', 100),
    correct: number('sample-correct', 100),
    concurrency: Math.max(1, number('concurrency', 4)),
    seed,
    gate: gate as GatePolicy,
    budget: {
      maxRounds: Math.max(1, number('max-rounds', DEFAULT_QUERY_BUDGET.maxRounds)),
      maxToolCalls: Math.max(1, number('max-tool-calls', DEFAULT_QUERY_BUDGET.maxToolCalls)),
      transcriptChars: Math.max(
        500,
        number('transcript-chars', DEFAULT_QUERY_BUDGET.transcriptChars),
      ),
    },
  };
}

/** One line of the verdict file, in the fields this runner reads. */
interface Verdict {
  readonly rank: number;
  readonly winner: string | null;
  /** The engine's order, truncated by the artifact that wrote it — the seed, when one is asked for. */
  readonly ranked: readonly string[];
}

/** Read the engine's per-case verdicts. */
function readVerdicts(path: string): Map<string, Verdict> {
  const verdicts = new Map<string, Verdict>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as {
      datapack: string;
      truthRank: number;
      ranked: readonly string[];
    };
    verdicts.set(row.datapack, {
      rank: row.truthRank,
      winner: row.ranked[0] ?? null,
      ranked: row.ranked,
    });
  }
  return verdicts;
}

/** One case's investigation, with the failure captured as a value rather than as a missing row. */
async function investigate(
  dir: string,
  verdict: Verdict,
  client: ReturnType<typeof createChatClient>,
  budget: QueryBudget,
  seeding: 'none' | 'engine',
  gate: GatePolicy,
): Promise<QueryArmRow | null> {
  const loader = new FSE26Loader();
  let raw;
  try {
    raw = loader.loadCase(dir);
  } catch {
    return null;
  }
  const bench = loader.toBenchmarkCase(raw);
  if (bench.callGraph.edges.length === 0) return null;
  const truth =
    raw.groundTruthServices.length > 0 ? raw.groundTruthServices : [bench.groundTruth.serviceId];
  // The seed is the engine's own order, and only the part the artifact carried: a runner that recomputed a ranking
  // here would be seeding an arm with an order no other artifact can reproduce.
  const seed: QuerySeed | null =
    seeding === 'engine' ? { source: 'engine', candidates: verdict.ranked } : null;
  const telemetry = buildTelemetry(bench);
  let outcome: QueryOutcome;
  try {
    outcome = await runQueryAgent(client, telemetry, budget, seed, gate);
  } catch (error) {
    // The DETAIL and not only the status: a 400 without the endpoint's own sentence turned one iteration into a
    // guess, and the sentence is not a secret.
    const detail = (error as { detail?: string }).detail ?? '';
    process.stderr.write(
      `\r${raw.datapack}: ${(error as Error).message.slice(0, 80)} — ${detail.slice(0, 160)}\n`,
    );
    return {
      datapack: raw.datapack,
      faultType: raw.faultType ?? 'unknown',
      truth,
      engineRank: verdict.rank,
      engineWinner: verdict.winner,
      answer: null,
      correct: false,
      stop: 'error',
      trace: '',
      seeded: seed !== null,
      rounds: 0,
      toolCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      rawAnswer: null,
      answeredBy: null,
      calls: [],
      inCone: false,
      answerOnset: null,
      priorOnset: null,
      intoAnswer: null,
      intoPrior: null,
      gateRefusals: 0,
    };
  }
  return {
    datapack: raw.datapack,
    faultType: raw.faultType ?? 'unknown',
    truth,
    engineRank: verdict.rank,
    engineWinner: verdict.winner,
    answer: outcome.answer,
    correct: outcome.answer !== null && truth.includes(outcome.answer),
    stop: outcome.stop,
    trace: outcome.trace,
    seeded: seed !== null,
    rounds: outcome.rounds,
    toolCalls: outcome.toolCalls,
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
    rawAnswer: outcome.rawAnswer,
    answeredBy: outcome.answeredBy,
    calls: outcome.investigated,
    // The cone is a property of the CASE, so it is recorded for the model's own answer whether or not the dispatched
    // policy read it: that is what lets the two unshipped policies be priced from this artifact at ¥0.
    inCone: outcome.rawAnswer !== null && onPriorCone(telemetry, outcome.rawAnswer, verdict.winner),
    // The evidence is read from the CASE, not from the transcript: a service the model never queried still has
    // telemetry, and a policy that could only judge what the model happened to look at would be pricing the
    // model's curiosity rather than the case's shape.
    answerOnset:
      outcome.rawAnswer === null ? null : (onsetOf(telemetry, outcome.rawAnswer) ?? null),
    priorOnset: verdict.winner === null ? null : (onsetOf(telemetry, verdict.winner) ?? null),
    intoAnswer:
      outcome.rawAnswer === null || verdict.winner === null
        ? null
        : netBetween(telemetry, verdict.winner, outcome.rawAnswer),
    intoPrior:
      outcome.rawAnswer === null || verdict.winner === null
        ? null
        : netBetween(telemetry, outcome.rawAnswer, verdict.winner),
    gateRefusals: outcome.gateRefusals,
  };
}

/** Run a list of tasks with a fixed number in flight. */
async function pool<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Map<number, R>();
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results.set(index, await work(items[index]!));
    }
  });
  await Promise.all(lanes);
  // The artifact keeps the sample's order rather than the completion order, so two runs of the same sample write
  // comparable files even when the endpoint's latency differs.
  return [...results.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
}

/** Entry point. */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const key = process.env[CHAT_KEY_VARIABLE] ?? '';
  if (key.trim() === '') {
    throw new Error(`${CHAT_KEY_VARIABLE} is not set: the arm cannot be measured without a key`);
  }
  const verdicts = readVerdicts(args.verdicts);
  const dirs = new Map<string, string>();
  for (const dir of discoverCaseDirs(args.dataDir)) {
    dirs.set(dir.split('/').at(-1)!, dir);
  }
  const misses = [...verdicts.entries()]
    .filter(([, verdict]) => verdict.rank !== 1)
    .map(([datapack]) => datapack)
    .sort();
  const correct = [...verdicts.entries()]
    .filter(([, verdict]) => verdict.rank === 1)
    .map(([datapack]) => datapack)
    .sort();
  // The two strata are counted AFTER the corpus filter, because the projection divides by them: a sample that
  // names 100 misses and can only load 84 has a repair rate over 84, and dividing by the request rather than by
  // the population would overstate every repair it found. A full-corpus dispatch (`--sample-misses` at the miss
  // count) makes both numbers the population, and the projection then collapses to identity by construction.
  const sampledMisses = stride(misses, args.misses).filter((pack) => dirs.has(pack));
  const sampledHits = stride(correct, args.correct).filter((pack) => dirs.has(pack));
  const sample = [...sampledMisses, ...sampledHits];
  process.stderr.write(
    `population ${verdicts.size} (${misses.length} miss / ${correct.length} correct); ` +
      `sample ${sample.length} (${sampledMisses.length} miss / ${sampledHits.length} correct); ` +
      `model ${args.model}\n`,
  );

  const client = createChatClient({
    apiKey: key,
    model: args.model,
    maxTokens: 200,
    temperature: 0,
    // The directive grammar is one line of text, not JSON. Saying `json_object` here would be a 400 on this
    // endpoint for a prompt that never mentions the word, and adding the word would be measuring a model that had
    // been asked for JSON.
    responseFormat: 'text',
  });
  let done = 0;
  const rows = await pool(sample, args.concurrency, async (datapack) => {
    const row = await investigate(
      dirs.get(datapack)!,
      verdicts.get(datapack)!,
      client,
      args.budget,
      args.seed,
      args.gate,
    );
    done += 1;
    if (done % 10 === 0) process.stderr.write(`\r${done}/${sample.length}`);
    return row;
  });
  const kept = rows.filter((row): row is QueryArmRow => row !== null);
  writeFileSync(args.out, `${kept.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const summary = summariseQueryArm(kept);
  const cost =
    (summary.promptTokens * PRICES.promptPerMillion +
      summary.completionTokens * PRICES.completionPerMillion) /
    1_000_000;
  process.stderr.write('\n');
  const seededWidth = sample.length === 0 ? 0 : (verdicts.get(sample[0]!)?.ranked.length ?? 0);
  console.log(
    `Free-investigation arm — ${args.model}, budget ${args.budget.maxRounds} rounds, ` +
      `seed ${args.seed}${args.seed === 'engine' ? ` (top-${seededWidth} of the engine order)` : ''}, ` +
      `gate ${args.gate}`,
  );
  console.log(
    `cases ${summary.cases} · answered ${summary.answered} · stops ${JSON.stringify(countStops(kept))}`,
  );
  // The instrumentation reading, before any accuracy reading: a run that ends most investigations on the budget
  // measured the budget. It is printed first because it decides whether the two lines under it mean anything.
  console.log(
    `answered share ${((summary.answered / Math.max(summary.cases, 1)) * 100).toFixed(1)}% · ` +
      `rounds per case ${(kept.reduce((sum, row) => sum + row.rounds, 0) / Math.max(kept.length, 1)).toFixed(2)}`,
  );
  console.log(
    `agent Top@1 ${summary.agentCorrect} · engine Top@1 on the same cases ${summary.engineCorrect}`,
  );
  console.log(
    `repairs ${summary.repairs} · breaks ${summary.breaks} · precision ` +
      `${summary.precision === null ? 'n/a' : summary.precision.toFixed(3)}`,
  );
  // The two strata are the two halves of the reading: what the arm KEPT of what it was given, and what it FOUND of
  // what it was not. One number called accuracy averages them and can hide either.
  console.log(
    `retained ${summary.engineHitsRetained}/${summary.engineHits} of the engine's own ` +
      `(${summary.retention === null ? 'n/a' : summary.retention.toFixed(3)}) · ` +
      `repaired ${summary.repairs}/${summary.cases - summary.engineHits} of its misses`,
  );
  console.log(
    `tokens ${summary.promptTokens}+${summary.completionTokens} · est. ¥${cost.toFixed(2)} at the declared prices`,
  );
  // The three policies, from ONE artifact. `dispatched` is the arm that ran; the other two are re-scores, so the
  // table costs nothing and the shipped surface is checkable against the priced one.
  // The sample is half misses and half hits BY CONSTRUCTION, so a reading on it is an EXCHANGE RATE and not an
  // effect. The last two columns transfer it to the population the arm ships on; the difference between them is
  // the misreading iteration 320 had to withdraw.
  console.log('gate policies (re-scored from this artifact):');
  console.log(
    '  policy  admitted refused repairs breaks precision correct retention  net@corpus  top1@corpus',
  );
  const population = { misses: misses.length, hits: correct.length };
  for (const reading of summariseGatePolicies(kept)) {
    const projection = projectOntoCorpus(
      reading,
      sampledMisses.length,
      sampledHits.length,
      population,
    );
    console.log(
      `  ${reading.policy.padEnd(7)} ${String(reading.admitted).padStart(8)} ` +
        `${String(reading.refused).padStart(7)} ${String(reading.repairs).padStart(7)} ` +
        `${String(reading.breaks).padStart(6)} ` +
        `${(reading.precision === null ? 'n/a' : reading.precision.toFixed(3)).padStart(9)} ` +
        `${String(reading.correct).padStart(7)} ` +
        `${(reading.retention === null ? 'n/a' : reading.retention.toFixed(3)).padStart(9)} ` +
        `${(projection.net === null ? 'n/a' : projection.net.toFixed(1)).padStart(10)} ` +
        `${(projection.top1 === null ? 'n/a' : `${projection.top1.toFixed(2)}%`).padStart(11)}` +
        `${reading.policy === args.gate ? '  <- dispatched' : ''}`,
    );
  }
  const fallbacks = kept.filter((row) => row.answeredBy === 'prior').length;
  console.log(
    `answered by the model ${kept.filter((row) => row.answeredBy === 'model').length} · ` +
      `by the prior ${fallbacks} · unanswered ${kept.filter((row) => row.answeredBy === null).length} · ` +
      `gate refusals ${kept.reduce((sum, row) => sum + row.gateRefusals, 0)}`,
  );
  const byFamily = new Map<string, { cases: number; repairs: number; breaks: number }>();
  for (const row of kept) {
    const cell = byFamily.get(row.faultType) ?? { cases: 0, repairs: 0, breaks: 0 };
    cell.cases += 1;
    if (row.correct && row.engineRank !== 1) cell.repairs += 1;
    if (!row.correct && row.engineRank === 1) cell.breaks += 1;
    byFamily.set(row.faultType, cell);
  }
  for (const [family, cell] of [...byFamily.entries()].sort((a, b) => b[1].cases - a[1].cases)) {
    console.log(
      `  ${family.padEnd(26)} cases ${String(cell.cases).padStart(3)} repairs ${cell.repairs} breaks ${cell.breaks}`,
    );
  }
}

/** How the loop stopped, by case. */
function countStops(rows: readonly QueryArmRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.stop] = (counts[row.stop] ?? 0) + 1;
  return counts;
}

await main();
