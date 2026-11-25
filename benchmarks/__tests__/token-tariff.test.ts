/**
 * The tariff is a clock, not a constant.
 *
 * Every cost figure this programme published before iteration 352 was priced with **2 / 8** CNY per million, and the
 * correction that followed read that table as a mistake. It is not: the published card has two time tiers, exactly
 * double each other, and 2 / 8 is the **peak** one. A runner that always printed the peak column therefore overstated
 * every off-peak run by 2× — the acceptance run of iteration 351 cost **1.69 CNY** and the line beside its own artifact
 * said **15.55**.
 *
 * So the tier cannot be a default chosen once in a constant. It is a function of the instant the run started, which the
 * artifact already records (`startedAt`), which makes the reading reproducible: the same artifact repriced months later
 * gets the same column it was billed under.
 *
 * The windows are the card's own, in UTC, and the edges are **half-open** — a closed hour billed at both tariffs would be
 * a 2× disagreement exactly at the boundary, which is the one place a reader would not look.
 */

import { describe, expect, it } from 'vitest';

import {
  DEEPSEEK_CHAT_RATES,
  DEEPSEEK_FLASH_RATES,
  isPeakTariff,
  servedRatesAt,
  tariffAt,
} from '../src/token-rates.js';

/** Monday 2026-11-23 — a weekday, used for every window boundary below. */
const monday = (hhmm: string): Date => new Date(`2026-11-23T${hhmm}:00Z`);

describe('the tariff in force at an instant', () => {
  it('charges the peak column inside both weekday windows', () => {
    // 01:00–04:00 and 06:00–10:00 UTC on weekdays. Both windows are tested at the start, the middle and the last
    // whole minute, because a window that is off by one hour looks exactly like a correct one in a single probe.
    for (const hhmm of ['01:00', '02:00', '03:59', '06:00', '07:30', '09:59']) {
      expect(isPeakTariff(monday(hhmm)), hhmm).toBe(true);
      expect(tariffAt(monday(hhmm)), hhmm).toBe('peak');
    }
  });

  it('charges off-peak between the windows and after the last one', () => {
    for (const hhmm of ['00:00', '00:59', '04:00', '05:59', '10:00', '12:00', '18:32', '23:59']) {
      expect(isPeakTariff(monday(hhmm)), hhmm).toBe(false);
      expect(tariffAt(monday(hhmm)), hhmm).toBe('off-peak');
    }
  });

  it('reads the edges as half-open, so no instant is billed twice', () => {
    // The last millisecond of a window is peak and the first of the gap is not: `[from, to)`. A closed interval would
    // bill 04:00:00 twice, once at each tariff, in the only place a boundary error can hide.
    expect(isPeakTariff(new Date('2026-11-23T03:59:59.999Z'))).toBe(true);
    expect(isPeakTariff(new Date('2026-11-23T04:00:00.000Z'))).toBe(false);
    expect(isPeakTariff(new Date('2026-11-23T09:59:59.999Z'))).toBe(true);
    expect(isPeakTariff(new Date('2026-11-23T10:00:00.000Z'))).toBe(false);
  });

  it('charges off-peak through the weekend, both days, inside the windows', () => {
    // Saturday 2026-11-21 and Sunday 2026-11-22, at 02:00 and 07:00 — instants that are peak on a weekday.
    for (const instant of [
      '2026-11-21T02:00:00Z',
      '2026-11-21T07:00:00Z',
      '2026-11-22T02:00:00Z',
      '2026-11-22T07:00:00Z',
    ]) {
      expect(tariffAt(new Date(instant)), instant).toBe('off-peak');
    }
  });

  it('returns the SERVED model card at the tier in force, not a third table', () => {
    // The card is one model at two columns: 1 / 4 / hit 0.02 off-peak, 2 / 8 / hit 0.04 at peak. Identity rather than
    // equality, so a change to either constant cannot leave `servedRatesAt` quoting a table nothing bills from.
    expect(servedRatesAt(monday('02:00'))).toBe(DEEPSEEK_CHAT_RATES);
    expect(servedRatesAt(monday('12:00'))).toBe(DEEPSEEK_FLASH_RATES);
    expect(servedRatesAt(new Date('2026-11-21T02:00:00Z'))).toBe(DEEPSEEK_FLASH_RATES);
  });

  it('prices the acceptance run at the column it was actually taken under', () => {
    // Run `45595943761` started at 18:32 Beijing on Wednesday 2026-11-25 = 10:32 UTC, which is off-peak. That is the
    // whole reason its invoice is 1.69 and not 3.38, and the reason the line beside its artifact printed neither.
    expect(tariffAt(new Date('2026-11-25T10:32:00Z'))).toBe('off-peak');
    expect(servedRatesAt(new Date('2026-11-25T10:32:00Z'))).toBe(DEEPSEEK_FLASH_RATES);
  });
});
