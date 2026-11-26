/**
 * The FSE'26 half's label history: the deployment's diagnosed past, read from the corpus before the first case
 * is scored.
 *
 * ## Why this half had no prior, and what that cost
 *
 * `run-fse26.ts` builds no history at all, so the twentieth term shipped inert on the benchmark that is one half
 * of this project's kill criterion — the census in `dispatch-surface-census.test.ts` records the omission as
 * `fse26: null` beside both fields. An arm that cannot be stated on one half is an arm with an undecidable other
 * half, which is the argument every other term in this runner's option table is exposed on. This module is what
 * closes it.
 *
 * ## Why the history is DERIVED here rather than read from a file
 *
 * The fault-free profile is a file because it is fitted, cached and reused across arms, and because a stale copy
 * of it was a real defect (the containment pass read a band from another corpus). The label history is neither:
 * it is a frequency over THIS corpus's own labels, so the only history a run may use is the one its own corpus
 * holds, and a path would be a second place where "which history" can be wrong. Deriving it costs one prefix
 * scan — see {@link readAcceptedFromCaseFile} — and it is derived only when the weight asks for it, so the
 * shipped configuration pays nothing.
 *
 * ## The two decisions it inherits rather than re-makes
 *
 * One incident, one answer, and leave-one-out. Both live in `label-prior-profiles.ts` and are applied by calling
 * it: a second implementation of either would be a second answer to what `p` means, and the engine's reading
 * would then differ from the arm's for arithmetic reasons rather than empirical ones.
 *
 * @module benchmarks/fse26-label-history
 */

import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';

import type { LabelPriorProfile } from '../../packages/core/src/index.js';

import {
  buildSystemHistories,
  priorExcludingTruth,
  type LabelledCase,
  type SystemHistory,
} from './label-prior-profiles.js';

/**
 * The deployment every RCABench datapack belongs to.
 *
 * One system, not nine cells: RCABench injects into Train Ticket alone, and a per-cell pool would make the
 * prior's denominator a function of the fault TYPE — the one split a prior over incidents may not use, because
 * the cell is what the ranking is being asked for.
 */
export const FSE26_DEPLOYMENT = 'trainticket';

/**
 * How many bytes of a `case.json` the fast path reads.
 *
 * The converter writes a one-line object whose fourth key is the label list, and 4 KiB covers it with room for a
 * long datapack id. The number is a WINDOW and not a contract: a file whose label sits past it is answered by the
 * full-parse fallback, which is asserted on a file deliberately padded past the window.
 */
const LABEL_PREFIX_BYTES = 4096;

/** The corpus's labelled history, and how much of the corpus the read could not see. */
export interface CorpusLabelHistory {
  /** The deployment the counts belong to — the key the engine's profile is built under. */
  readonly deployment: string;
  /** Incidents per service, and how many incidents the deployment holds. */
  readonly history: SystemHistory;
  /**
   * Cases the read could not open or parse.
   *
   * Reported rather than thrown: the scoring loop already tolerates a load error and continues, so a history
   * pass that aborted would turn one corrupt datapack into a run with no artifact. The count is what keeps that
   * tolerance from being silent — a history fitted on 1 400 of 1 422 cases is a different denominator.
   */
  readonly unreadable: number;
}

/**
 * Find the `groundTruthServices` array in a prefix of a case file.
 *
 * The array is located by its key, then parsed by `JSON.parse` on exactly the slice between its brackets: the
 * scan's only job is to find where the array ENDS, which it does by tracking string literals so a `]` inside a
 * service name cannot close it early.
 *
 * @param text - A prefix (or the whole) of the file, decoded as UTF-8.
 * @returns The labels, or `undefined` when the array is not wholly inside `text`.
 * @throws Error when the key is present and its value is not an array of strings.
 */
function labelsInWindow(text: string): readonly string[] | undefined {
  const key = text.indexOf('"groundTruthServices"');
  if (key === -1) return undefined;
  let i = key + '"groundTruthServices"'.length;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text[i] !== ':') {
    throw new Error('groundTruthServices is not followed by a colon');
  }
  i++;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text[i] !== '[') {
    throw new Error('groundTruthServices is not an array');
  }
  const start = i;
  let inString = false;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === ']') {
      const parsed: unknown = JSON.parse(text.slice(start, i + 1));
      if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
        throw new Error('groundTruthServices is not an array of strings');
      }
      return parsed as readonly string[];
    }
  }
  // The window ended inside the array: not a violation, an incomplete read.
  return undefined;
}

/**
 * Read one datapack's accepted answers, without parsing the case's series.
 *
 * @param path - The datapack's `case.json`.
 * @returns The accepted answers, in the corpus's order.
 * @throws Error when the file cannot be read, is not JSON, or carries no label list.
 */
export function readAcceptedFromCaseFile(path: string): readonly string[] {
  let prefix = '';
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(LABEL_PREFIX_BYTES);
    const read = readSync(fd, buffer, 0, LABEL_PREFIX_BYTES, 0);
    // `subarray` rather than the whole buffer: `allocUnsafe` leaves the tail uninitialised, and a scanner run
    // over a tail of stale heap bytes could find a bracket it did not read.
    prefix = buffer.subarray(0, read).toString('utf8');
  } finally {
    closeSync(fd);
  }
  const fromPrefix = labelsInWindow(prefix);
  if (fromPrefix !== undefined) return fromPrefix;
  // The fallback reads and parses the WHOLE file, so the answer is the loader's answer even when the label sits
  // past the window. It is also where a malformed file fails, which is the behaviour the caller counts.
  const fromFull = labelsInWindow(readFileSync(path, 'utf8'));
  if (fromFull === undefined) throw new Error(`no groundTruthServices in ${path}`);
  return fromFull;
}

/**
 * Read the corpus's diagnosed history, one incident per datapack.
 *
 * The population is every directory passed in — the whole corpus, not the slice a `--max-cases` run scores —
 * because the history is a property of the DEPLOYMENT and not of the evaluation slice. A case the run does not
 * score is still an incident the deployment diagnosed, and excluding it would make `p` a function of the
 * command line.
 *
 * @param dirs - The corpus's case directories.
 * @param read - The label reader, or a stand-in.
 * @returns The deployment's counts and the number of cases the read could not answer for.
 */
export function buildCorpusLabelHistory(
  dirs: readonly string[],
  read: (path: string) => readonly string[] = readAcceptedFromCaseFile,
): CorpusLabelHistory {
  const cases: LabelledCase[] = [];
  let unreadable = 0;
  for (const dir of dirs) {
    let accepted: readonly string[];
    try {
      accepted = read(join(dir, 'case.json'));
    } catch {
      unreadable++;
      continue;
    }
    cases.push({ caseId: dir, system: FSE26_DEPLOYMENT, accepted });
  }
  const histories = buildSystemHistories(cases);
  return {
    deployment: FSE26_DEPLOYMENT,
    history: histories.get(FSE26_DEPLOYMENT) ?? { counts: new Map(), labelled: 0 },
    unreadable,
  };
}

/**
 * One case's profile: the deployment's history with this case's own incident subtracted.
 *
 * @param history - The corpus history, as {@link buildCorpusLabelHistory} returns it.
 * @param accepted - The case's accepted answers, in the corpus's order.
 * @returns The profile the engine reads for this case.
 */
export function priorForCase(
  history: CorpusLabelHistory,
  accepted: readonly string[],
): LabelPriorProfile {
  return priorExcludingTruth(
    new Map([[history.deployment, history.history]]),
    history.deployment,
    accepted[0],
  );
}
