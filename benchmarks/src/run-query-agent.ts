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
import { billLine, billNote } from './cost-model.js';
import {
  buildTelemetry,
  DEFAULT_QUERY_BUDGET,
  engineOpinionOf,
  floorReadingNote,
  gateTableCaveat,
  netBetween,
  onPriorCone,
  onsetOf,
  priorTopOf,
  projectOntoCorpus,
  readEntryPrior,
  readInterfacePrior,
  runQueryAgent,
  stride,
  summariseGatePolicies,
  summariseQueryArm,
  type GatePolicy,
  type QueryArmRow,
  type QueryBudget,
  type QueryOutcome,
  type QuerySeed,
  type Resolution,
} from './query-agent.js';
import { runMetadataOf } from './run-metadata.js';
import { servedRatesAt, tariffAt } from './token-rates.js';

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
  /**
   * What a refusal settles on: `seed` for the order the arm shows (every arm before this flag), `none` for no
   * fallback, `engine` for the engine's answer even when the prompt showed nothing.
   */
  readonly fallback: 'none' | 'engine' | 'seed';
  /** What an override must show before it replaces the prior. `none` is the ungated control. */
  readonly gate: GatePolicy;
  /** Whether a settled answer is re-read by the entry prior. `none` is the arm as 318–321 shipped it. */
  readonly resolve: Resolution;
  /**
   * Skip the model entirely on a case whose engine margin already clears this value. `0` is off, which is the
   * product and every arm before 348.
   *
   * Not an arm in the presentation sense: a skipped case ships the same name a refusal would have shipped, so the
   * comparison against a `0` run is a comparison of PRICE at equal answers, not of accuracy. It is a product knob
   * for that reason — the user chooses what a certain case costs.
   */
  readonly certaintyFloor: number;
  /**
   * Whether the harness holds an order the model can walk with `TOOL next`, or `none` for the free arm.
   *
   * `engine` is not `seed`: nothing is printed in the prompt, so the model reads one service per call and never sees
   * the sequence. That distinction is the whole point — §318 measured the printed order as WORSE than no order.
   */
  readonly schedule: 'none' | 'engine';
  /**
   * Whether `TOOL fleet` prints the pipeline's own first five candidates beside the case's surprises.
   *
   * `engine` for the arm that shows the shortlist, `none` for the fleet read every earlier arm printed. This is NOT a
   * seed and NOT a schedule: the instruction is byte-identical to the free arm's, and the only difference is a section
   * of a tool's OUTPUT — so a difference between the two arms is a difference in evidence, not in what the model was
   * told. That property is why it exists: 342b measured four appended prompt lines costing 43 points while the tool
   * those lines advertised was never called.
   */
  readonly fleetOrder: 'none' | 'engine';
  /**
   * `onset` for the arm whose per-service `metric` reads carry the service's first `ERROR`/`FATAL` offset and count,
   * `none` for every arm before it.
   *
   * `logs` — the tool that carries the lines themselves — is opened in 0.44 of the five calls per case, and iteration
   * 344 found the largest block of the shortlist arm's loss on cases where the arm did NOT act. This channel moves the
   * timestamp into a read the arm already makes 1.33 times per case, spends no call, and carries no ranking: a
   * timestamp can be weighed against the model's own order, where a list of names replaces it.
   */
  readonly evidenceOrder: 'none' | 'onset';
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
  // A fallback that defaulted to something other than the shown order would silently change every arm that was
  // measured before this flag existed, so the default IS the shown order.
  const fallback = map.get('fallback') ?? 'seed';
  const fallbacks: readonly string[] = ['none', 'engine', 'seed'];
  if (!fallbacks.includes(fallback)) {
    throw new Error('--fallback must be `none`, `engine` or `seed`');
  }
  // A gate is a policy a run states, and an unknown one is refused rather than defaulted: a typo that silently
  // measured the ungated control would publish a gated reading that no gate produced.
  const gate = map.get('gate') ?? 'none';
  const gates: readonly GatePolicy[] = ['none', 'cited', 'cone', 'contrast', 'lag'];
  if (!gates.includes(gate as GatePolicy)) {
    throw new Error('--gate must be `none`, `cited`, `cone`, `contrast` or `lag`');
  }
  // A resolver, like a gate, is a rule a run STATES: a typo that silently measured no resolver would publish an
  // unread arm under the name of a read one.
  const resolve = map.get('resolve') ?? 'none';
  const resolvers: readonly Resolution[] = ['none', 'entry-prior', 'edge-novel'];
  if (!resolvers.includes(resolve as Resolution)) {
    throw new Error('--resolve must be `none`, `entry-prior` or `edge-novel`');
  }
  // A schedule, like a gate, is a policy a run STATES. The default is `none`, so every arm measured before this flag
  // existed keeps its prompt byte-identical and its reading unchanged.
  const schedule = map.get('schedule') ?? 'none';
  if (schedule !== 'none' && schedule !== 'engine') {
    throw new Error('--schedule must be `none` or `engine`');
  }
  // A shortlist is a third arm of the same family and defaults to `none`, so a run that does not ask for it prints the
  // fleet read every published number was taken under.
  const fleetOrder = map.get('fleet-order') ?? 'none';
  if (fleetOrder !== 'none' && fleetOrder !== 'engine') {
    throw new Error('--fleet-order must be `none` or `engine`');
  }
  // A fourth arm of the same shape as `--fleet-order`: it changes one field of a tool's output and defaults to none,
  // so a run that does not ask for it prints the text every published number was taken under.
  const evidenceOrder = map.get('evidence-order') ?? 'none';
  if (evidenceOrder !== 'none' && evidenceOrder !== 'onset') {
    throw new Error('--evidence-order must be `none` or `onset`');
  }
  // A price knob rather than an arm: it reads a number, and a number outside the range a margin is measured on is a
  // typo that would otherwise skip the whole corpus (`1e9`) or nothing at all, silently, in a ¥20 dispatch.
  const certaintyFloor = number('certainty-floor', 0);
  if (!(certaintyFloor >= 0) || !Number.isFinite(certaintyFloor)) {
    throw new Error('--certainty-floor must be a finite engine margin at or above 0');
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
    fallback: fallback as Args['fallback'],
    gate: gate as GatePolicy,
    resolve: resolve as Resolution,
    schedule: schedule as Args['schedule'],
    fleetOrder: fleetOrder as Args['fleetOrder'],
    evidenceOrder: evidenceOrder as Args['evidenceOrder'],
    certaintyFloor,
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
  /**
   * The engine's own sort value for the two candidates it published first and second.
   *
   * Optional because the artifact only gained the columns in iteration 336: a verdict file written before them is a
   * file the certainty guard must leave alone rather than one it may read as decided.
   */
  readonly top1Score?: number | null;
  readonly top2Score?: number | null;
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
      top1Score?: number | null;
      top2Score?: number | null;
    };
    verdicts.set(row.datapack, {
      rank: row.truthRank,
      winner: row.ranked[0] ?? null,
      ranked: row.ranked,
      top1Score: row.top1Score,
      top2Score: row.top2Score,
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
  fallback: 'none' | 'engine',
  gate: GatePolicy,
  resolve: Resolution,
  schedule: readonly string[] | null,
  shortlist: readonly string[] | null,
  onset: boolean,
  certaintyFloor: number,
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
  // The order a refusal settles on, which is the SAME object when the arm shows one: the ranking a run was given is
  // the one it falls back to, so a seeded arm cannot fall back to an order no artifact carries.
  const fallbackOrder: QuerySeed | null =
    fallback === 'engine' ? { source: 'engine', candidates: verdict.ranked } : null;
  const telemetry = buildTelemetry(bench);
  // The incumbent's NAME, and not only whether one exists. `incumbent` answers "was the gate defending anything";
  // the name answers "did the prior agree with the engine", which is the next floor rule worth pricing and the one
  // question this artifact could not be asked — a boolean cannot be re-read as a name later. Costs no token.
  const incumbentName = priorTopOf(fallbackOrder, telemetry);
  let outcome: QueryOutcome;
  try {
    // The engine's opinion travels BESIDE the seed: a free arm is shown no order and still ships a case the engine
    // was decided about, and a guard that read the seed would be switched off by `--seeding none`.
    const engine = engineOpinionOf({
      winner: verdict.winner,
      top1Score: verdict.top1Score,
      top2Score: verdict.top2Score,
    });
    outcome = await runQueryAgent(
      client,
      telemetry,
      budget,
      seed,
      gate,
      resolve,
      fallbackOrder,
      engine,
      schedule,
      shortlist,
      onset,
      certaintyFloor,
    );
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
      engineMargin: engineOpinionOf({
        winner: verdict.winner,
        top1Score: verdict.top1Score,
        top2Score: verdict.top2Score,
      }).margin,
      answer: null,
      correct: false,
      stop: 'error',
      trace: '',
      seeded: seed !== null,
      scheduled: schedule === null ? null : schedule.length,
      fleetOrder: shortlist === null ? 'none' : 'engine',
      onsetOrder: onset ? 'onset' : 'none',
      // A row whose call FAILED still records an empty census rather than omitting the column: an artifact where the
      // field is missing cannot be distinguished from one written before the field existed.
      tools: {},
      nextServed: 0,
      // The INCUMBENT is a property of the case and the order, not of the investigation: a case whose call failed
      // still had one, and a row that said it did not would raise the gate-table caveat on a seeded arm.
      incumbent: incumbentName !== null,
      priorTop: incumbentName,
      rounds: 0,
      toolCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      // Empty rather than the requested name: a call that failed was served by nothing, and a record that filled in
      // the request would be claiming a model answered when none did.
      servedModel: '',
      cacheHitTokens: 0,
      rawAnswer: null,
      answeredBy: null,
      calls: [],
      inCone: false,
      answerOnset: null,
      priorOnset: null,
      intoAnswer: null,
      intoPrior: null,
      gateRefusals: 0,
      entry: null,
      entryChildErrors: null,
      belowFails: null,
      rawSurprise: null,
      priorSurprise: null,
      novelCaller: null,
      novelRise: null,
    };
  }
  const witnessed = readInterfacePrior(telemetry);
  const settledSaid = readEntryPrior(telemetry, outcome.answer);
  const rawSaid = readEntryPrior(telemetry, outcome.rawAnswer);
  const priorSaid = readEntryPrior(telemetry, verdict.winner);
  return {
    datapack: raw.datapack,
    faultType: raw.faultType ?? 'unknown',
    truth,
    engineRank: verdict.rank,
    engineWinner: verdict.winner,
    engineMargin: engineOpinionOf({
      winner: verdict.winner,
      top1Score: verdict.top1Score,
      top2Score: verdict.top2Score,
    }).margin,
    answer: outcome.answer,
    correct: outcome.answer !== null && truth.includes(outcome.answer),
    stop: outcome.stop,
    trace: outcome.trace,
    seeded: seed !== null,
    scheduled: schedule === null ? null : schedule.length,
    fleetOrder: shortlist === null ? 'none' : 'engine',
    onsetOrder: onset ? 'onset' : 'none',
    // Counted while the directives ran, so a per-tool count here is not a count of the trace's last 2 000 characters.
    tools: outcome.tools,
    nextServed: outcome.nextServed,
    // What the LOOP had, which is the fallback's first name the case actually carries.
    incumbent: incumbentName !== null,
    priorTop: incumbentName,
    rounds: outcome.rounds,
    toolCalls: outcome.toolCalls,
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
    // What the endpoint SAID it served, and what it served from cache. The first is not the model that was asked
    // for — `deepseek-chat` is answered by `deepseek-flash` — and the second is how a run proves a cache saving
    // instead of inferring one from a price.
    servedModel: outcome.servedModel,
    cacheHitTokens: outcome.cacheHitTokens,
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
    // The resolver's evidence is read from the CASE for both sides the artifact can settle on, so a run that
    // dispatched `lag` also prices what either rule would have done with `none`'s answers and with `cone`'s.
    // One read per side: `readEntryPrior` finds the entry by walking the graph, and reading the same side twice
    // would walk it twice to answer the same question.
    entry: settledSaid.entry,
    entryChildErrors: settledSaid.entryChildErrors,
    // Answer-independent, so the settled side's read is the case's read.
    belowFails: settledSaid.belowFails,
    rawSurprise: rawSaid.answerSurprise,
    priorSurprise: priorSaid.answerSurprise,
    // Read once per case from the CASE's failing interfaces: the witness does not depend on the answer, so one
    // column prices `edge-novel` for every policy and both sides of every fallback.
    novelCaller: witnessed.novelCaller,
    novelRise: witnessed.novelRise,
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
  // Recorded before anything else: this record exists because a run was once compared with one from two days
  // earlier and the difference was read as an arm effect.
  const startedAt = new Date().toISOString();
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
      args.fallback === 'seed' ? args.seed : args.fallback,
      args.gate,
      args.resolve,
      // The schedule is the engine's order, which is also what a seed would show — and here it is NEVER shown. A
      // runner that recomputed an order would be scheduling a route no other artifact can reproduce, so this is the
      // same `ranked` column the seed reads and the same width the artifact carried.
      args.schedule === 'engine' ? verdicts.get(datapack)!.ranked : null,
      // The shortlist is the SAME column the schedule reads, printed instead of served: one ranking, two arms, so a
      // reading of either is a reading of the engine's own order and not of a runner's recomputation.
      args.fleetOrder === 'engine' ? verdicts.get(datapack)!.ranked : null,
      // The onset channel reads nothing from the verdicts: it is a property of the case's own log stream, so this arm
      // is orthogonal to every order-carrying arm and can be combined with any of them.
      args.evidenceOrder === 'onset',
      // The price knob travels the same road as the arm switches: a floor read here and dropped at the second hop
      // would spend the whole budget and report a saving that never happened — the exact defect iteration 345 paid
      // for with `onset`, which parsed, logged and reached 0 of 532 cases.
      args.certaintyFloor,
    );
    done += 1;
    if (done % 10 === 0) process.stderr.write(`\r${done}/${sample.length}`);
    return row;
  });
  const kept = rows.filter((row): row is QueryArmRow => row !== null);
  writeFileSync(args.out, `${kept.map((row) => JSON.stringify(row)).join('\n')}\n`);
  // Beside the rows rather than inside them: 532 copies of a header is a file that says it 532 times and is read
  // zero times, and the fields that make two runs comparable are the ones a reader needs exactly once.
  const meta = runMetadataOf({
    model: args.model,
    startedAt,
    endedAt: new Date().toISOString(),
    cases: sample.length,
    maxRounds: args.budget.maxRounds,
    maxToolCalls: args.budget.maxToolCalls,
    seed: args.seed,
    gate: args.gate,
    // The EFFECTIVE fallback, not the flag: `--fallback seed` with `--seed none` settles on nothing, and a record that
    // printed the flag would say a free arm had a prior. This is the field iteration 346 needed and did not have.
    fallback: args.fallback === 'seed' ? args.seed : args.fallback,
    resolve: args.resolve,
    schedule: args.schedule,
    fleetOrder: args.fleetOrder,
    evidenceOrder: args.evidenceOrder,
    certaintyFloor: args.certaintyFloor,
    // The harness itself. The instruction the model reads is a function of this tree, so two artifacts from different
    // commits are two instruments — GitHub sets `GITHUB_SHA` on every job, and a local run says `null` rather than
    // inventing a revision from a dirty working copy.
    revision: process.env.GITHUB_SHA ?? null,
  });
  writeFileSync(`${args.out}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);

  const summary = summariseQueryArm(kept);
  // The tariff in force when THIS run started, not when it was read: the card has two columns 2× apart, and a line that
  // picked one as a constant would overstate every off-peak run — which is what this line did until iteration 353.
  const startedAtDate = new Date(startedAt);
  const rates = servedRatesAt(startedAtDate);
  const tariff = tariffAt(startedAtDate);
  process.stderr.write('\n');
  const seededWidth = sample.length === 0 ? 0 : (verdicts.get(sample[0]!)?.ranked.length ?? 0);
  const fallbackLabel = args.fallback === 'seed' ? args.seed : args.fallback;
  console.log(
    `Free-investigation arm — asked for ${args.model}, budget ${args.budget.maxRounds} rounds, ` +
      `seed ${args.seed}${args.seed === 'engine' ? ` (top-${seededWidth} of the engine order)` : ''}, ` +
      `gate ${args.gate}, fallback ${fallbackLabel}, resolve ${args.resolve}, schedule ${args.schedule}, ` +
      `fleet ${args.fleetOrder}, onset ${args.evidenceOrder}, ` +
      // The floor changes what the arm SPENDS and how many cases it answers without a model, so a banner that omitted
      // it would print the same line for a ¥10.41 run and a ¥7.76 one — the reading a human takes before any table.
      `floor ${args.certaintyFloor > 0 ? args.certaintyFloor : 'none'}, ` +
      `revision ${meta.revision ?? 'unrecorded'}`,
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
  // The census, printed BEFORE the accuracy lines because it decides whether they can be read at all. It exists in
  // this form because 342b's per-tool table had to be computed from the artifact's `trace`, which keeps only its last
  // 2 000 characters — so the first call of every investigation was elided and `TOOL fleet`, usually the first call,
  // was reported at 0.5 %. A census counted as the directives run cannot be elided.
  const cases = Math.max(kept.length, 1);
  const toolTotals = new Map<string, number>();
  for (const row of kept) {
    for (const [tool, count] of Object.entries(row.tools ?? {})) {
      toolTotals.set(tool, (toolTotals.get(tool) ?? 0) + count);
    }
  }
  console.log(
    `census: distinct services ${(kept.reduce((sum, row) => sum + row.calls.length, 0) / cases).toFixed(3)} · ` +
      `calls per case ${(kept.reduce((sum, row) => sum + row.toolCalls, 0) / cases).toFixed(2)} · ` +
      `next served ${kept.reduce((sum, row) => sum + (row.nextServed ?? 0), 0)}`,
  );
  console.log(
    `  tools per case ${[...toolTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => `${tool} ${(count / cases).toFixed(2)}`)
      .join(' · ')}`,
  );
  console.log(
    `agent Top@1 ${summary.agentCorrect} · engine Top@1 on the same cases ${summary.engineCorrect}`,
  );
  console.log(
    `repairs ${summary.repairs} · breaks ${summary.breaks} · precision ` +
      `${summary.precision === null ? 'n/a' : summary.precision.toFixed(3)}`,
  );
  // Printed BESIDE the ratio rather than in the docs, because the ratio is the line a reader quotes. A floored case can
  // be neither a repair nor a break, so the population behind these three numbers shrank.
  const floorNote = floorReadingNote(args.certaintyFloor);
  if (floorNote !== null) console.log(floorNote);
  // The two strata are the two halves of the reading: what the arm KEPT of what it was given, and what it FOUND of
  // what it was not. One number called accuracy averages them and can hide either.
  console.log(
    `retained ${summary.engineHitsRetained}/${summary.engineHits} of the engine's own ` +
      `(${summary.retention === null ? 'n/a' : summary.retention.toFixed(3)}) · ` +
      `repaired ${summary.repairs}/${summary.cases - summary.engineHits} of its misses`,
  );
  // The bill, from the same function the audit's table is built with, and at the column this run was billed under.
  // `billLine` reads `cacheHitTokens`, which the summary now carries: an artifact whose 81 % cache hits are priced as
  // misses is not a conservative estimate of the invoice, it is a different number (1.69 → 15.55 on run 45595943761).
  console.log(billLine(summary, rates, tariff));
  const billCaveat = billNote(summary, rates);
  if (billCaveat !== null) console.log(billCaveat);
  // The three policies, from ONE artifact. `dispatched` is the arm that ran; the other two are re-scores, so the
  // table costs nothing and the shipped surface is checkable against the priced one.
  // The sample is half misses and half hits BY CONSTRUCTION, so a reading on it is an EXCHANGE RATE and not an
  // effect. The last two columns transfer it to the population the arm ships on; the difference between them is
  // the misreading iteration 320 had to withdraw.
  console.log('gate policies (re-scored from this artifact):');
  console.log(
    '  policy  admitted refused repairs breaks precision correct retention  net@corpus  top1@corpus  resolved  top1@resolved',
  );
  const population = { misses: misses.length, hits: correct.length };
  const total = population.misses + population.hits;
  for (const reading of summariseGatePolicies(kept, args.resolve)) {
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
        `${(projection.top1 === null ? 'n/a' : `${projection.top1.toFixed(2)}%`).padStart(11)} ` +
        `${String(reading.resolved).padStart(8)} ` +
        `${`${((reading.correctResolved / total) * 100).toFixed(2)}%`.padStart(13)}` +
        `${reading.policy === args.gate ? '  <- dispatched' : ''}`,
    );
  }
  const caveat = gateTableCaveat(kept);
  if (caveat !== null) console.log(`  [caveat] ${caveat}`);
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
