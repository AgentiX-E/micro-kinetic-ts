/**
 * The diagnostic dump as ONE file, however many case groups it covers.
 *
 * A `--diagnose-dump <path>` invocation is usually a whole suite: `--suite re1` evaluates Online
 * Boutique, SockShop and Train Ticket, and the analyzer that reads the result has no notion of a
 * group — it reads one file of cases. The first version of this feature built the text inside the
 * group loop and wrote it there, so each system's `writeFileSync` truncated the last one's: the
 * `re1` dump held 125 Train Ticket blocks and not one Online Boutique or SockShop case, while the
 * console printed the same `125 cases, 125 blocks` three times. Nothing downstream could see it —
 * 125 is a plausible number for RE1, and every screen ran happily on a third of the run.
 *
 * So the file is owned by one object for the whole invocation: records accumulate across groups,
 * `write()` happens once, and both of the ways the artifact can stop describing the run — a record
 * arriving after the file was written, and the same case recorded twice — raise where the mistake is
 * made instead of leaving a file that parses.
 *
 * @module benchmarks/fse26-diagnose-dump
 */

import { writeFileSync } from 'node:fs';

/** One case group's share of a dump. */
export interface DiagnoseDumpCoverage {
  /** The group, as `<system>:<suite>` — the key the runner already groups cases by. */
  readonly group: string;
  /** How many cases this group contributed. */
  readonly cases: number;
}

/** What was written, and out of which groups. */
export interface DiagnoseDumpSummary {
  /** The file. */
  readonly path: string;
  /** Total cases, the sum of {@link coverage}. */
  readonly cases: number;
  /** Per-group counts, sorted by group, so the report is deterministic. */
  readonly coverage: readonly DiagnoseDumpCoverage[];
}

/**
 * Accumulate rendered diagnostic blocks for one dump file.
 *
 * The blocks are opaque: this type decides WHERE they go and WHEN, never what they say. That keeps
 * the one owner of the format (the sink) and the one owner of the file (here) apart.
 */
export class DiagnoseDump {
  readonly #path: string;
  readonly #header: string;
  /** Blocks in record order, which is the case order the FSE'26 dump also uses. */
  readonly #blocks: string[] = [];
  readonly #groups = new Map<string, number>();
  readonly #datapacks = new Set<string>();
  #written = false;

  /**
   * @param path - The file to write on {@link write}.
   * @param header - The configuration line the run was made under, as the runner's own banner
   *   renders it. Passed in rather than derived so the artifact and the banner cannot disagree.
   */
  constructor(path: string, header: string) {
    this.#path = path;
    this.#header = header;
  }

  /**
   * Record one case's block.
   *
   * @param group - The group the case came from, for the coverage report.
   * @param datapack - The case id, which must be unique across the whole file.
   * @param block - The sink's rendering, appended verbatim.
   */
  record(group: string, datapack: string, block: string): void {
    if (this.#written) {
      throw new Error(`case ${datapack} was recorded after it was written and would be absent`);
    }
    if (this.#datapacks.has(datapack)) {
      throw new Error(`case ${datapack} was recorded twice`);
    }
    this.#datapacks.add(datapack);
    this.#blocks.push(block);
    this.#groups.set(group, (this.#groups.get(group) ?? 0) + 1);
  }

  /**
   * Write the file, once.
   *
   * @returns What went in, per group.
   */
  write(): DiagnoseDumpSummary {
    if (this.#written) {
      throw new Error(`${this.#path} has already been written`);
    }
    this.#written = true;
    writeFileSync(this.#path, `${this.#header}\n${this.#blocks.join('')}`);
    return {
      path: this.#path,
      cases: this.#blocks.length,
      // Sorted by KEY, so the report is deterministic, and with no comparator of its own: group
      // names are Map keys and therefore distinct, so a three-way comparator would carry an
      // equality arm that cannot be reached.
      coverage: [...this.#groups.keys()]
        .sort()
        .map((group) => ({ group, cases: this.#groups.get(group)! })),
    };
  }
}

/**
 * Render the one-line report of a written dump.
 *
 * The count is reported WITH its groups because `4 cases` is not a measurement until the reader
 * knows whether it came from four systems or one — the same reason the screens quote their
 * population next to their gain.
 *
 * @param summary - A written dump's summary.
 * @returns The line, without indentation.
 */
export function formatDiagnoseDumpLine(summary: DiagnoseDumpSummary): string {
  const groups = summary.coverage.map((one) => `${one.group} ${one.cases}`).join(', ');
  return `${summary.path} (${summary.cases} cases${groups === '' ? '' : `: ${groups}`})`;
}
