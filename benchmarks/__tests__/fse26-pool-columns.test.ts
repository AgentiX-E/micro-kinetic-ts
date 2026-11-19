/**
 * The three POOL columns on the FSE'26 verdict file, and the derivation that fills them.
 *
 * ## The gap this closes
 *
 * The verdict file was written to make a published average re-scorable, and it holds four fields: what the
 * corpus accepted and what the engine answered, truncated to the reporting width. That is enough to re-score
 * `Top@5`. It is not enough to answer the one question the topological deduction raises — **did the truth leave
 * the candidate pool, or was it merely ranked low?** — because a truth at rank 9 and a truth the pool never held
 * both read `absent` from a five-wide row, and the two have different owners
 * (`docs/topo-discount-scope.md` §7.4: one is a ranking failure, the other is the operator behaving exactly as
 * `gate = 1` says it should).
 *
 * The RCAEval half has carried the answer since the loss census: `truthRank`, `pool` and
 * `truthAnomalyBefore`, read by `classifyTruthAbsence` into `ranked / explained / silent / not-in-graph`. The
 * FSE'26 half carried none of them, so the corpus with 1 422 cases — the one whose published cell every arm is
 * scored against — could not distinguish a deletion from a miss at all. Four arms on this operator were read by
 * watching totals move instead of by reading a mechanism, and this is the missing column.
 *
 * ## What the three columns say, and what each absence means
 *
 * - `truthRank` — the best rank among the accepted set over the WHOLE order the run computed, `0` when the pool
 *   held no accepted service. A column rather than a judgement: `Top@1` is `truthRank === 1`, and a reader who
 *   wants `Top@20` no longer needs a second run.
 * - `pool` — how many candidates the order held, i.e. the set the deduction decided. `truthRank > pool` is
 *   unrepresentable, and `pool === 0` is a case whose graph produced nothing to rank.
 * - `truthAnomalyBefore` — the accepted answer's own anomaly BEFORE the deduction, `null` when none of the
 *   accepted ids is a node of the graph. Read against zero it is the split the census needs: `0` is a silent
 *   origin, `> 0` with `truthRank === 0` is a node the operator explained away.
 *
 * ## Why the columns are OPTIONAL on the record and always written by the runner
 *
 * A verdict is also a value a caller can build without a graph — a re-serialisation, a hand-written fixture, a
 * row from a run that took the tolerance path. Those rows have no pool and no anomaly, and writing `0` for them
 * would report a measurement ("nothing moved") where the truth is an absence. So the writer emits each column
 * only when the row carries it, and the parser accepts both shapes: an archived five-field file still reads,
 * which is what keeps every number this repository has published re-readable.
 */

import { describe, expect, it } from 'vitest';

import {
  formatPerCaseVerdict,
  parsePerCaseVerdicts,
  poolColumns,
  type PerCaseVerdict,
} from '../src/fse26-per-case.js';

/** A ranked entry, in the shape the engine returns. */
const at = (serviceId: string): { readonly serviceId: string } => ({ serviceId });

/** A row with the four published fields and nothing else. */
const row = (over: Partial<PerCaseVerdict> = {}): PerCaseVerdict => ({
  datapack: 'ts0-ts-basic-service-stress-abc123',
  faultType: 'JVMMemoryStress',
  accepted: ['ts-basic-service'],
  ranked: ['ts-basic-service', 'ts-station-service'],
  ...over,
});

describe('poolColumns: what the order held and where the truth sat in it', () => {
  it('reports the best accepted rank over the WHOLE order, past the reporting width', () => {
    const ranking = ['a', 'b', 'c', 'd', 'e', 'f', 'truth'].map(at);
    const columns = poolColumns(ranking, ['truth'], () => 2);
    expect(columns.truthRank).toBe(7);
    expect(columns.pool).toBe(7);
  });

  it('reads `0` when the pool held no accepted service — absent, not last', () => {
    const columns = poolColumns(['a', 'b'].map(at), ['truth'], () => 2);
    expect(columns.truthRank).toBe(0);
  });

  it('reports the pool as the length of the order it was handed, and `0` for an empty one', () => {
    expect(poolColumns([], ['truth'], () => 2).pool).toBe(0);
    expect(poolColumns(['a'].map(at), ['truth'], () => 2).pool).toBe(1);
  });

  it('looks the anomaly up for the BEST-placed accepted service, not the first declared', () => {
    const ranking = ['noise', 'second', 'first'].map(at);
    const seen: string[] = [];
    const columns = poolColumns(ranking, ['first', 'second'], (id) => {
      seen.push(id);
      return id === 'second' ? 7 : 1;
    });
    expect(columns.truthRank).toBe(2);
    expect(seen).toEqual(['second']);
    expect(columns.truthAnomalyBefore).toBe(7);
  });

  it('falls back to the first declared accepted id when nothing is ranked, so a deletion still says whether it moved', () => {
    const seen: string[] = [];
    const columns = poolColumns(['noise'].map(at), ['first', 'second'], (id) => {
      seen.push(id);
      return id === 'first' ? 3 : 1;
    });
    expect(columns.truthRank).toBe(0);
    expect(seen).toEqual(['first']);
    expect(columns.truthAnomalyBefore).toBe(3);
  });

  it('keeps a measured zero as zero — a silent origin is a reading, not an absence', () => {
    expect(poolColumns(['truth'].map(at), ['truth'], () => 0).truthAnomalyBefore).toBe(0);
  });

  it('reports `null` when the accepted id is not a node of the graph, which is a different fact from zero', () => {
    expect(poolColumns(['noise'].map(at), ['off-graph'], () => undefined).truthAnomalyBefore).toBe(
      null,
    );
  });

  it('reports `null` for a case whose graph was never built, even though something was ranked', () => {
    expect(poolColumns([], [], () => undefined).truthAnomalyBefore).toBeNull();
  });
});

describe('the pool columns on the verdict line', () => {
  it('writes the three columns in a fixed order after the ranking', () => {
    const parsed = JSON.parse(
      formatPerCaseVerdict(row({ truthRank: 2, pool: 9, truthAnomalyBefore: 1.5 })),
    );
    expect(Object.keys(parsed)).toEqual([
      'datapack',
      'faultType',
      'accepted',
      'ranked',
      'truthRank',
      'pool',
      'truthAnomalyBefore',
    ]);
  });

  it('writes nothing it was not given, so a row without a graph keeps the published four fields', () => {
    const keys = Object.keys(JSON.parse(formatPerCaseVerdict(row())));
    expect(keys).toEqual(['datapack', 'faultType', 'accepted', 'ranked']);
  });

  it('writes a `null` anomaly rather than dropping the column, because absent and off-graph differ', () => {
    const line = formatPerCaseVerdict(row({ truthRank: 0, pool: 4, truthAnomalyBefore: null }));
    expect(JSON.parse(line).truthAnomalyBefore).toBeNull();
  });

  it('round-trips a full row through the parser', () => {
    const full = row({ truthRank: 3, pool: 7, truthAnomalyBefore: 0.25 });
    expect(parsePerCaseVerdicts(formatPerCaseVerdict(full))).toEqual([full]);
  });

  it('still reads an archived four-field line, because every published number was read from one', () => {
    const archived = JSON.stringify({
      datapack: 'ts0-ts-basic-service-stress-abc123',
      faultType: 'JVMMemoryStress',
      accepted: ['ts-basic-service'],
      ranked: ['ts-basic-service'],
    });
    const [parsed] = parsePerCaseVerdicts(archived);
    expect(parsed?.truthRank).toBeUndefined();
    expect(parsed?.pool).toBeUndefined();
    expect(parsed?.truthAnomalyBefore).toBeUndefined();
  });

  it('refuses a rank that is not a non-negative integer', () => {
    for (const truthRank of [-1, 1.5, '1', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parsePerCaseVerdicts(toLine({ truthRank }))).toThrow(/truthRank/);
    }
  });

  it('refuses a pool that is not a non-negative integer', () => {
    for (const pool of [-1, 0.5, '4', null, Number.NaN]) {
      expect(() => parsePerCaseVerdicts(toLine({ pool }))).toThrow(/pool/);
    }
  });

  it('refuses an anomaly that is neither a finite number nor null', () => {
    // `NaN` and `Infinity` are not in this list and cannot be: JSON has no spelling for either, so
    // `JSON.stringify` writes `null` for both and the parser never sees the value — which is why `null` is a
    // legal state the writer emits on purpose rather than a hole in the validation.
    expect(JSON.parse(JSON.stringify({ x: Number.NaN })).x).toBeNull();
    expect(JSON.parse(JSON.stringify({ x: Number.POSITIVE_INFINITY })).x).toBeNull();
    for (const truthAnomalyBefore of ['0.5', true, []]) {
      expect(() => parsePerCaseVerdicts(toLine({ truthAnomalyBefore }))).toThrow(
        /truthAnomalyBefore/,
      );
    }
  });
});

/** One line carrying the four published fields plus whatever the case under test adds. */
function toLine(extra: Record<string, unknown>): string {
  return JSON.stringify({
    datapack: 'ts0-ts-basic-service-stress-abc123',
    faultType: 'JVMMemoryStress',
    accepted: ['ts-basic-service'],
    ranked: ['ts-basic-service'],
    ...extra,
  });
}

/**
 * The refusals, because a reader that coerces a malformed row scores a case the corpus never stated.
 *
 * Every one of these was uncovered when the pool columns were added — the module reported 89.5 % statements —
 * and they are the half of the contract that protects an archived artefact from being read as a different corpus.
 * A row is refused by LINE NUMBER, so the message has to carry it.
 */
describe('the parser refuses a row this module would never have written', () => {
  it('refuses a line that is not JSON', () => {
    expect(() => parsePerCaseVerdicts('{not json')).toThrow(/line 1 is not JSON/);
  });

  it('refuses a JSON value that is not an object', () => {
    expect(() => parsePerCaseVerdicts('42')).toThrow(/line 1 is not an object/);
    expect(() => parsePerCaseVerdicts('"a line"')).toThrow(/line 1 is not an object/);
    // `null` parses to an object-shaped value whose type is `object`, so the guard has to test it explicitly —
    // and an ARRAY is an object in JSON, which is why it falls through to the field checks rather than here.
    expect(() => parsePerCaseVerdicts('null')).toThrow(/line 1 is not an object/);
    expect(() => parsePerCaseVerdicts('[]')).toThrow(/datapack on line 1/);
  });

  it('refuses a missing or empty datapack, which is the case’s only identity', () => {
    expect(() => parsePerCaseVerdicts(JSON.stringify({ faultType: 'X' }))).toThrow(
      /datapack on line 1 is not a non-empty string/,
    );
    expect(() => parsePerCaseVerdicts(toLine({ datapack: '' }))).toThrow(/datapack/);
  });

  it('refuses a missing faultType', () => {
    expect(() =>
      parsePerCaseVerdicts(JSON.stringify({ datapack: 'd', accepted: [], ranked: [] })),
    ).toThrow(/faultType on line 1 is not a string/);
  });

  it('refuses an accepted set that is not an array of non-empty strings', () => {
    expect(() => parsePerCaseVerdicts(toLine({ accepted: 'ts-basic-service' }))).toThrow(
      /accepted on line 1/,
    );
    expect(() => parsePerCaseVerdicts(toLine({ accepted: ['ok', ''] }))).toThrow(/accepted/);
  });

  it('refuses a ranking that is not an array of non-empty strings', () => {
    expect(() => parsePerCaseVerdicts(toLine({ ranked: [1] }))).toThrow(/ranked on line 1/);
  });

  it('names the line the refusal is on, not just the field', () => {
    const text = `${toLine({})}\n${toLine({ truthRank: -1 })}`;
    expect(() => parsePerCaseVerdicts(text)).toThrow(/truthRank on line 2/);
  });

  it('reads a `null` anomaly back as null, so off-graph survives a round trip', () => {
    const [parsed] = parsePerCaseVerdicts(toLine({ truthAnomalyBefore: null }));
    expect(parsed?.truthAnomalyBefore).toBeNull();
  });
});
