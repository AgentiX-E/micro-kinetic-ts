/**
 * Every artifact has to say WHEN it ran, on WHICH model, with WHICH flags.
 *
 * Iteration 345 read its own artifact and found `err=` in 0 of 532 transcripts. The cause was a positional argument
 * that was never passed — and the consequence was worse than a wasted dispatch: that run was a plain **free arm**, and
 * it scored **178 / 532** where the free arm scored **414** on the same ids two days earlier (McNemar on the paired
 * cases: 245 discordant one way, 9 the other, p < 0.001). Nothing in the artifact said which day it was from, so the
 * comparison looked like an arm effect until the transcripts were read one by one.
 *
 * A row cannot carry the answer: 532 rows repeating the same header is a file that says it 532 times and is read zero
 * times. So the metadata is a sibling file written by the runner, and it carries the three things that would have made
 * this session's error visible in one `cat`:
 *
 * - **when** — start and end, to the second, so two runs can never be silently compared across a day boundary;
 * - **which model** — the endpoint's name, because a supplier's model is a moving target and this programme's whole
 *   standing was measured against a name, not a version;
 * - **which arms** — every flag that changes what the model sees, so "free" is a fact about the file rather than a
 *   claim about the dispatch form.
 *
 * The function is pure so the runner's clock and the test's clock are the same object.
 */

import { describe, expect, it } from 'vitest';

import { runMetadataOf } from '../src/run-metadata.js';

describe('run metadata', () => {
  const base = {
    model: 'deepseek-chat',
    startedAt: '2026-11-25T00:35:25.000Z',
    endedAt: '2026-11-25T01:31:07.000Z',
    cases: 532,
    maxRounds: 6,
    maxToolCalls: 10,
    schedule: 'none' as const,
    fleetOrder: 'none' as const,
    evidenceOrder: 'none' as const,
    certaintyFloor: 0,
    seed: 'none' as const,
    gate: 'none' as const,
    // Required rather than optional, and required on purpose: these two fields are the ones whose absence from the
    // record let a `gate contrast + fallback engine + resolve edge-novel` artifact be compared with a bare arm and the
    // difference published as model drift. A field the compiler demands is a field no future runner can forget.
    fallback: 'none' as const,
    resolve: 'none',
  };

  it('states the transcript cap when it is not the harness default, and stays silent when it is', () => {
    // A cap changes what the model can still SEE, so two runs that differ only in it are two arms — the same argument
    // the floor's banner line makes. It is named only when it is not the default, for the reason `seed=none` is not
    // named: a record that spelled every default would make every old artifact a difference.
    expect(runMetadataOf(base).budget.transcriptChars).toBeUndefined();
    const capped = runMetadataOf({ ...base, transcriptChars: 900 });
    expect(capped.budget.transcriptChars).toBe(900);
    expect(capped.arms).toContain('transcript=900');
    expect(runMetadataOf(base).arms).toBe('free');
  });

  it('states the per-result cut beside the cap, because the two levers are not the same lever', () => {
    // The transcript cap drops old blocks from the front and moves the prefix; the result cut renders each block once,
    // on entry, and leaves the prefix alone. Two runs that differ in WHICH lever they used would otherwise be two
    // records that differ in a number, and a reader would take the difference for a cap size.
    expect(runMetadataOf(base).budget.resultChars).toBeUndefined();
    const cut = runMetadataOf({ ...base, resultChars: 100 });
    expect(cut.budget.resultChars).toBe(100);
    expect(cut.arms).toContain('result=100');
    expect(cut.arms).not.toContain('transcript=');
  });

  it('records when the run happened, because a row cannot', () => {
    const meta = runMetadataOf(base);
    expect(meta.startedAt).toBe('2026-11-25T00:35:25.000Z');
    expect(meta.endedAt).toBe('2026-11-25T01:31:07.000Z');
    expect(meta.durationSeconds).toBe(3_342);
  });

  it('names the model, since a supplier renames a target without telling its callers', () => {
    expect(runMetadataOf(base).model).toBe('deepseek-chat');
  });

  it('states every arm that changes what the model sees, and calls the default one `free`', () => {
    // One string instead of four, because the failure this file exists for was a reader comparing two files and
    // noticing nothing: `free` has to be a value a diff can show.
    expect(runMetadataOf(base).arms).toBe('free');
    expect(runMetadataOf({ ...base, fleetOrder: 'engine', evidenceOrder: 'onset' }).arms).toBe(
      'fleet=engine+onset=onset',
    );
  });

  it('lists every arm in the record when none of them is at its default', () => {
    // The full string, in the order a reader reads it, because a record that named four of five arms would be the
    // same failure in a smaller font.
    expect(
      runMetadataOf({
        ...base,
        seed: 'engine',
        gate: 'lag',
        schedule: 'engine',
        fleetOrder: 'engine',
        evidenceOrder: 'onset',
      }).arms,
    ).toBe('seed=engine+gate=lag+schedule=engine+fleet=engine+onset=onset');
  });

  it('keeps the budget beside the arms, so a wider investigation is visible too', () => {
    const wide = runMetadataOf({ ...base, maxRounds: 11 });
    expect(wide.budget).toEqual({ maxRounds: 11, maxToolCalls: 10 });
  });

  it('refuses a timestamp that is not a timestamp', () => {
    // `Date.parse` answers NaN for prose, and NaN would make every arithmetic check pass silently — a duration of NaN
    // in the record is a comparison waiting to be made against it.
    expect(() => runMetadataOf({ ...base, startedAt: 'yesterday' })).toThrow(/ISO timestamps/);
    expect(() => runMetadataOf({ ...base, endedAt: '' })).toThrow(/ISO timestamps/);
  });

  it('refuses a clock that ends before it starts', () => {
    // A negative duration is the only way this record can be wrong about itself, and a run that is wrong about when it
    // ran is exactly the record this session needed and did not have.
    expect(() => runMetadataOf({ ...base, endedAt: '2026-11-24T23:00:00.000Z' })).toThrow(
      /endedAt/,
    );
  });
});

describe('the certainty floor in the record', () => {
  const base = {
    model: 'deepseek-chat',
    startedAt: '2026-11-25T00:35:25.000Z',
    endedAt: '2026-11-25T01:46:00.000Z',
    cases: 1_422,
    maxRounds: 6,
    maxToolCalls: 10,
    seed: 'none' as const,
    gate: 'none' as const,
    fallback: 'none' as const,
    resolve: 'none' as const,
    schedule: 'none' as const,
    fleetOrder: 'none' as const,
    evidenceOrder: 'none' as const,
    certaintyFloor: 0,
  };

  it('is named when it is on, because a floor changes the answer and not only the price', () => {
    // A run at floor 0.87 answers 582 cases with the fallback's name instead of the model's. Two runs at two floors
    // are two configurations, and a delta between them is not an arm effect — the same rule that caught the 346
    // pairing, applied to the newest knob before it can cost a day.
    expect(runMetadataOf({ ...base, certaintyFloor: 0.87 }).arms).toContain('floor=0.87');
  });

  it('is absent when it is off, so every artifact before this flag reads unchanged', () => {
    expect(runMetadataOf({ ...base, certaintyFloor: 0 }).arms).toBe('free');
  });
});
