/**
 * Price an artifact, and price the floor that would have made it cheaper.
 *
 * `tsx benchmarks/src/run-cost-audit.ts --artifact artifacts/agentic/query-agent.ndjson`
 *
 * ## Why this is a tool and not a paragraph
 *
 * The question "why is every step this expensive" was answered by hand once, and the answer was wrong twice before
 * it was right. Every figure below is read from the artifact's own `promptTokens` / `completionTokens` /
 * `answeredBy` / `engineMargin` columns, so the reading is re-derivable at zero cost whenever the corpus or the
 * prices change — and the arithmetic that says 786 cases never needed the model cannot drift from the artifact that
 * says so.
 *
 * ## What it prints
 *
 *   1. The bill, split into the two columns that are not interchangeable.
 *   2. The same bill by WHO SETTLED the case — a case the prior settled is a model call that was paid for and
 *      discarded, which is the only stratum a saving can act on.
 *   3. The floor curve: what skipping the model above each margin would have saved, and what it would have cost in
 *      cases. The loss-free floor is marked, because a saving that loses a case is not on the table.
 *
 * Exits 1 when the artifact cannot be priced — no rows, or no `engineMargin` column — rather than printing a table
 * beside a caveat. A cost reading nobody can act on is worse than no reading.
 */

import { readFileSync } from 'node:fs';

import { auditCost, lossFreeFloor, ruleEdges, skipAt, type CostRow } from './cost-model.js';
import { DEEPSEEK_CHAT_RATES, type TokenRates } from './token-rates.js';

/** The command line. */
interface Args {
  readonly artifact: string;
  /** The floors to price. The loss-free boundary is added to this list if it is not already in it. */
  readonly floors: readonly number[];
  /** Rates, in CNY per million tokens. Defaults to the invoice the module documents. */
  readonly rates: TokenRates;
}

function number(argv: Map<string, string>, name: string, fallback: number): number {
  const raw = argv.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number, got \`${raw}\``);
  return value;
}

function parse(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) throw new Error(`unexpected argument \`${token}\``);
    map.set(token.slice(2), argv[index + 1] ?? '');
    index += 1;
  }
  const artifact = map.get('artifact') ?? '';
  if (artifact === '') throw new Error('--artifact is required');
  // 1.5 is in the default list because it is the bar the workflow ships: a report that omitted the shipped
  // configuration would price every floor except the one a reader is about to dispatch.
  const floors = (map.get('floors') ?? '0.3,0.5,0.8,0.9,1.0,1.2,1.5').split(',').map((one) => {
    const value = Number(one);
    if (!Number.isFinite(value))
      throw new Error(`--floors must be comma-separated numbers, got \`${one}\``);
    return value;
  });
  return {
    artifact,
    floors,
    rates: {
      inputPerMillion: number(map, 'input-price', DEEPSEEK_CHAT_RATES.inputPerMillion),
      outputPerMillion: number(map, 'output-price', DEEPSEEK_CHAT_RATES.outputPerMillion),
      cacheHitPerMillion: number(
        map,
        'hit-price',
        DEEPSEEK_CHAT_RATES.cacheHitPerMillion ?? DEEPSEEK_CHAT_RATES.inputPerMillion,
      ),
    },
  };
}

/** The artifact's rows in the columns the audit reads, or a refusal naming the first row that is not one. */
function readRows(path: string): CostRow[] {
  const text = readFileSync(path, 'utf8');
  const rows: CostRow[] = [];
  let line = 0;
  for (const raw of text.split('\n')) {
    line += 1;
    if (raw.trim() === '') continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(
        `${path}:${String(line)} is not JSON: a truncated artifact is not a cheaper one`,
      );
    }
    rows.push({
      datapack: String(parsed['datapack'] ?? ''),
      promptTokens: Number(parsed['promptTokens'] ?? 0),
      completionTokens: Number(parsed['completionTokens'] ?? 0),
      answeredBy: (parsed['answeredBy'] as string | null | undefined) ?? null,
      correct: parsed['correct'] === true,
      engineWinner: (parsed['engineWinner'] as string | null | undefined) ?? null,
      // Left ABSENT when the artifact does not carry it, so `cost-model` can tell a file written before the column
      // existed from one that carries it and a null — two answers that price very differently.
      ...(Object.hasOwn(parsed, 'engineMargin')
        ? { engineMargin: Number(parsed['engineMargin']) }
        : {}),
      // Same rule as `engineMargin`: absent stays absent, so the audit can tell a file that never recorded the cache
      // from one that recorded a zero.
      ...(Object.hasOwn(parsed, 'cacheHitTokens')
        ? { cacheHitTokens: Number(parsed['cacheHitTokens']) }
        : {}),
      truth: Array.isArray(parsed['truth']) ? (parsed['truth'] as string[]) : [],
    });
  }
  return rows;
}

const money = (value: number): string => value.toFixed(2);
const pct = (value: number): string => `${(value * 100).toFixed(2)} %`;

function report(rows: readonly CostRow[], args: Args): string {
  const audit = auditCost(rows, args.rates);
  const lines: string[] = [];
  lines.push(
    `cost audit — ${String(audit.cases)} cases, ${money(audit.total)} CNY (${audit.perCase.toFixed(4)} per case)`,
  );
  lines.push(
    `input ${audit.inputTokens.toLocaleString('en-US')} prompt tokens = ${pct(audit.inputShare)} of the bill · ` +
      `output ${audit.outputTokens.toLocaleString('en-US')} completion tokens`,
  );
  if (audit.perCase > 0) {
    lines.push(
      `the question costs ${(audit.inputTokens / audit.cases).toFixed(0)} tokens a case; the answer costs ${(audit.outputTokens / audit.cases).toFixed(1)}`,
    );
  }
  // The cache line, printed only when the artifact can speak to it: `null` is "this file cannot say", `0` is "it served
  // nothing", and a report that showed them the same would repeat iteration 349's withdrawal.
  lines.push(
    audit.cacheHitTokens === null
      ? 'cache: not recorded by this artifact — the bill above is the no-cache bound'
      : `cache: ${audit.cacheHitTokens.toLocaleString('en-US')} prompt tokens served from cache ` +
          `(${pct(audit.cacheHitShare ?? 0)} of input) at ${args.rates.cacheHitPerMillion ?? 'the miss'} ` +
          `per million`,
  );
  lines.push('');
  lines.push(
    `${'settled by'.padEnd(12)} ${'cases'.padStart(6)} ${'correct'.padStart(8)} ${'CNY'.padStart(8)} ${'per case'.padStart(9)} ${'wasted'.padStart(8)}`,
  );
  for (const stratum of audit.strata) {
    // "wasted" is the cost of a stratum the MODEL did not settle: the tokens were spent and the answer discarded.
    const wasted = stratum.by === 'model' ? 0 : stratum.cost;
    lines.push(
      `${stratum.by.padEnd(12)} ${String(stratum.cases).padStart(6)} ${String(stratum.correct).padStart(8)} ` +
        `${money(stratum.cost).padStart(8)} ${stratum.perCase.toFixed(4).padStart(9)} ${money(wasted).padStart(8)}`,
    );
  }
  const discarded = audit.strata
    .filter((s) => s.by !== 'model')
    .reduce((sum, s) => sum + s.cost, 0);
  if (discarded > 0) {
    lines.push(
      `  ${money(discarded)} (${pct(discarded / audit.total)}) bought answers the resolver discarded — the stratum a floor can act on`,
    );
  }
  lines.push('');
  const free = lossFreeFloor(rows, args.rates);
  const edges = ruleEdges(rows);
  const floors = [
    ...new Set([...args.floors, ...(edges.destroys === null ? [] : [edges.destroys])]),
  ].sort((a, b) => a - b);
  lines.push(
    `${'floor'.padStart(6)} ${'skipped'.padStart(8)} ${'saved CNY'.padStart(10)} ${'gain'.padStart(6)} ${'loss'.padStart(6)} ${'accuracy'.padStart(10)}`,
  );
  for (const floor of floors) {
    const reading = skipAt(rows, floor, args.rates);
    const mark =
      edges.destroys !== null && Math.abs(floor - edges.destroys) < 1e-9
        ? '  <- no case moves'
        : '';
    lines.push(
      `${floor.toFixed(3).padStart(6)} ${String(reading.skipped).padStart(8)} ` +
        `${money(reading.saved).padStart(10)} ${String(reading.gains).padStart(6)} ` +
        `${String(reading.losses).padStart(6)} ${pct(reading.accuracy).padStart(10)}${mark}`,
    );
  }
  lines.push('');
  if (edges.destroys === null) {
    lines.push(
      'the engine answer never destroys a correct case in this artifact: every floor is loss-free',
    );
  } else {
    // The distance between these two numbers is the whole difference between a rule and a fit. Stated in margins
    // rather than in cases, because it is the next corpus that has to clear it.
    lines.push(
      `the engine answer stops destroying cases above ${edges.destroys.toFixed(4)} and stops repairing them ` +
        `above ${edges.repairs === null ? 'no margin at all' : edges.repairs.toFixed(4)}: every floor above ` +
        `${edges.destroys.toFixed(4)} changes no case in this artifact`,
    );
  }
  if (free !== null) {
    lines.push(
      `maximal no-op floor ${free.floor.toFixed(4)}: ${String(free.skipped)} cases (${pct(free.skipped / audit.cases)}) silenced, ` +
        `${money(free.saved)} CNY saved (${pct(free.saved / audit.total)}), ` +
        `${String(free.gains)} gained against ${String(free.losses)} lost, accuracy ${pct(free.accuracy)}`,
    );
  } else {
    lines.push('no loss-free floor: every skip in this artifact costs at least one case');
  }
  return lines.join('\n');
}

function main(): void {
  const args = parse(process.argv.slice(2));
  const rows = readRows(args.artifact);
  process.stdout.write(`${report(rows, args)}\n`);
}

main();
