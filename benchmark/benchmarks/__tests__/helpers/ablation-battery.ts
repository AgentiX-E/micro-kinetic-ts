/**
 * The ablation battery's rows, read out of the runner's own text.
 *
 * ## Why this exists
 *
 * `run-ablation.ts` executes `main()` at import time, so its row array cannot be imported and any fence about
 * a row is a fence about the file's text. Two suites needed that reading within one iteration — the
 * propagation-channel fence in `latency-routes.test.ts` (is the 2x2 over {corpus, floor} complete?) and the
 * flags fence in `ablation-engine-options.test.ts` (does every row that varies a knob spread the all-off
 * flags?) — and two readers of one array are two answers to "what rows does the battery have". This repository
 * has paid for that shape more than once, so the reader is shared rather than copied, the reason
 * `source-text.ts` gives one file over.
 *
 * ## The row shape, and why it is read rather than listed
 *
 * Every literal in the battery opens on a line of its own and ends with its `label`, and that is the one shape
 * the whole array shares. A row is therefore the text between its opening brace and its label — which is what
 * makes the reading survive a row that names something BETWEEN the flags and the overrides. Three did not: the
 * corpus rows name `latencyView` in that gap, and an assertion built as an adjacent `flags: …, overrides: …`
 * pair matched their six predecessors and silently released them.
 *
 * ## Comments are stripped first
 *
 * A row's own comment explains `latMinRise = 10.3` and the value `1` four lines above the literal that carries
 * it, and a fence that read the raw text would find an axis in the explanation. That is the defect
 * `source-text.ts` exists to prevent, so the text is stripped before anything is parsed.
 *
 * @module benchmarks/__tests__/helpers/ablation-battery
 */

import { stripComments } from './source-text.js';

/** One battery row, with the axes a fence can be written about. */
export interface BatteryRow {
  /** The row's `label`, exactly as the artifact prints it. */
  readonly label: string;
  /** The row's `flags` literal, e.g. `{ ...ALL_OFF_FLAGS }`. */
  readonly flags: string | undefined;
  /** The row's `overrides` literal, e.g. `{ latMinRise: 1 }`, or `undefined` when it varies none. */
  readonly overrides: string | undefined;
  /**
   * Which corpus the row's latency array comes from.
   *
   * `'shipped'` is the ABSENT value rather than an empty string, because a row that omits `latencyView` ranks
   * on the published corpus — and a fence comparing cells has to read that as a cell.
   */
  readonly corpus: string;
  /** The row's `latMinRise` override, or `'default'` when it inherits the shipped floor. */
  readonly floor: string;
  /** The row's `latWeight` override, or `'default'` when it inherits the shipped weight. */
  readonly latWeight: string;
}

const literal = (body: string, key: string): string | undefined =>
  new RegExp(`${key}: (\\{[^}]*\\})`).exec(body)?.[1];

/**
 * Every row of the ablation battery, in declaration order.
 *
 * A `label:` that is not a row — the `AblationRow` interface's own field — has no row opening before it and is
 * skipped rather than filed as a row with no axes.
 *
 * @param src - The text of `run-ablation.ts`.
 * @returns The rows, with their axes.
 */
export const batteryRows = (src: string): readonly BatteryRow[] => {
  const parts = stripComments(src).split("label: '");
  const rows: BatteryRow[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    const previous = parts[i - 1]!;
    const open = previous.lastIndexOf('\n  {');
    if (open < 0) continue;
    const label = parts[i]!.slice(0, parts[i]!.indexOf("'"));
    const body = previous.slice(open);
    rows.push({
      label,
      flags: literal(body, 'flags'),
      overrides: literal(body, 'overrides'),
      corpus: /latencyView: '([a-z-]+)'/.exec(body)?.[1] ?? 'shipped',
      floor: /latMinRise: (\d+)/.exec(body)?.[1] ?? 'default',
      latWeight: /latWeight: (\d+)/.exec(body)?.[1] ?? 'default',
    });
  }
  return rows;
};
