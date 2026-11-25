/**
 * CLI entry point for the transcript-cap reading.
 *
 * Thin for the reason every CLI in this directory is: the counting lives in `transcript-reading.ts`, because this file
 * runs at import time and a test cannot load it.
 *
 * Three inputs, two of them required. The anchor is required because a cap's effect is a DIFFERENCE and a capped
 * artifact alone cannot state one — the failure mode iteration 346 published as a 236-case drift.
 *
 * @module benchmarks/run-cap-reading
 */

import { readFileSync } from 'node:fs';

import { billLine } from './cost-model.js';
import { servedRatesAt, tariffAt } from './token-rates.js';
import { capReadingOf, perCallCurveOf, type CapRow } from './transcript-reading.js';

/** The flags this runner accepts. */
interface Args {
  readonly anchor: string;
  readonly capped: string;
  /** The instant the capped run started, so its bill is priced at the column it was taken under. */
  readonly cappedAt: Date;
}

/** Parse the flags. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index] ?? '';
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const required = (name: string): string => {
    const value = map.get(name);
    if (value === undefined || value === '') throw new Error(`--${name} is required`);
    return value;
  };
  const cappedAt = map.get('capped-at') ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(cappedAt)))
    throw new Error('--capped-at must be an ISO timestamp');
  const known = new Set(['anchor', 'capped', 'capped-at']);
  for (const key of map.keys()) if (!known.has(key)) throw new Error(`unknown flag: --${key}`);
  return { anchor: required('anchor'), capped: required('capped'), cappedAt: new Date(cappedAt) };
}

/** Read one ndjson artifact into the fields this reading touches, leaving absent columns absent. */
function loadRows(path: string): CapRow[] {
  const rows: CapRow[] = [];
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (line.trim() === '') continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(
        `${path}:${String(index + 1)} is not JSON: a truncated artifact is not a cheaper one`,
      );
    }
    const numbers = (value: unknown): number[] | undefined =>
      Array.isArray(value) ? value.map((one) => Number(one)) : undefined;
    rows.push({
      datapack: String(parsed['datapack'] ?? ''),
      answer: (parsed['answer'] as string | null | undefined) ?? null,
      calls: Array.isArray(parsed['calls']) ? (parsed['calls'] as string[]) : [],
      correct: parsed['correct'] === true,
      rounds: Number(parsed['rounds'] ?? 0),
      promptTokens: Number(parsed['promptTokens'] ?? 0),
      completionTokens: Number(parsed['completionTokens'] ?? 0),
      ...(Object.hasOwn(parsed, 'cacheHitTokens')
        ? { cacheHitTokens: Number(parsed['cacheHitTokens']) }
        : {}),
      ...(Object.hasOwn(parsed, 'turnTokens') ? { turnTokens: numbers(parsed['turnTokens']) } : {}),
      ...(Object.hasOwn(parsed, 'turnLatencyMs')
        ? { turnLatencyMs: numbers(parsed['turnLatencyMs']) }
        : {}),
    });
  }
  return rows;
}

/** Render the reading. */
function report(anchor: readonly CapRow[], capped: readonly CapRow[], args: Args): string {
  const reading = capReadingOf(anchor, capped);
  const rates = servedRatesAt(args.cappedAt);
  const tariff = tariffAt(args.cappedAt);
  const share = (part: number, whole: number): string =>
    whole === 0 ? '—' : `${((part / whole) * 100).toFixed(2)} %`;
  const saved = reading.uncached.anchor - reading.uncached.capped;
  const lines = [
    `transcript cap — paired on ${String(reading.shared)} cases` +
      (reading.onlyAnchor === 0 && reading.onlyCapped === 0
        ? ''
        : ` (only anchor ${String(reading.onlyAnchor)}, only capped ${String(reading.onlyCapped)})`),
    // The trajectory line is the acceptance test, printed first because it is the one the literature names: an
    // agent's loop is deterministic given its actions, so a preserved next action preserves everything after it.
    `trajectory preserved ${String(reading.trajectoryPreserved)} (${share(reading.trajectoryPreserved, reading.shared)})` +
      ` · directives changed ${String(reading.trajectoryChanged)} · answer changed ${String(reading.answerChanged)}`,
    `accuracy: +${String(reading.gains)} gained / -${String(reading.losses)} lost`,
    `uncached prompt ${reading.uncached.anchor.toLocaleString('en-US')} -> ${reading.uncached.capped.toLocaleString('en-US')} tokens` +
      ` (${share(saved > 0 ? saved : 0, reading.uncached.anchor)} removed)`,
    `model time ${reading.latencyMs === null ? 'not recorded' : `${String(reading.latencyMs.anchor)} -> ${String(reading.latencyMs.capped)} ms`}`,
    '',
    billLine(
      {
        promptTokens: reading.tokens.anchor,
        completionTokens: reading.completion.anchor,
        cacheHitTokens:
          reading.uncached.anchor === 0 ? null : reading.tokens.anchor - reading.uncached.anchor,
      },
      rates,
      tariff,
    ).replace('est.', 'anchor est.'),
    billLine(
      {
        promptTokens: reading.tokens.capped,
        completionTokens: reading.completion.capped,
        cacheHitTokens:
          reading.uncached.capped === 0 ? null : reading.tokens.capped - reading.uncached.capped,
      },
      rates,
      tariff,
    ).replace('est.', 'capped est.'),
  ];
  const curve = perCallCurveOf(capped);
  if (curve.length === 0) {
    lines.push('', 'per-call curve: not recorded by this artifact');
  } else {
    lines.push(
      '',
      `per-call prompt, capped arm: ${curve.map((point) => `${String(point.call)}:${point.mean.toFixed(0)}`).join(' ')}`,
    );
  }
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  console.log(report(loadRows(args.anchor), loadRows(args.capped), args));
}

main();
