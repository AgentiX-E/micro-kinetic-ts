/**
 * SOTA leaderboard — the single source of truth for Micro-Kinetic's RCAEval
 * positioning, with mandatory provenance and integrity validation.
 *
 * Why this module exists: the project's earlier "1.84× academic SOTA" headline
 * was a strawman produced by dividing our 77.4% by a third-party nofire.ai
 * figure for GALA (42%), which (a) mixed cross-paper numbers and (b) missed the
 * 2025–2026 non-LLM frontier (PRISM 68%, the RCAEval author's own method).
 *
 * This module encodes the corrected, defensible position as data *and* as a set
 * of guards that make dishonest cross-cohort comparison impossible at compile
 * time and fail loudly at runtime:
 *
 *   - Every entry carries a {@link Provenance}: either `ours-measured` (with the
 *     reproducing commit) or `published` (with an arXiv id / DOI). No number is
 *     claimed without a source.
 *   - `validateLeaderboard` enforces range, provenance completeness, and
 *     duplicate-free uniqueness.
 *   - `requireComparable` / `marginTo` refuse to compare entries from different
 *     cohorts, metrics, or systems — the exact cross-paper comparison that
 *     produced the strawman.
 *
 * The canonical data mirrors `docs/sota-comparison.md` (v3). When a benchmark
 * readback changes a cell, update {@link createSotaLeaderboard} here first; the
 * doc and any paper are then regenerated from this table.
 *
 * @module benchmarks/leaderboard/sota-leaderboard
 */

// ── Types ─────────────────────────────────────────────────

/** Analysis paradigm of a root-cause method. */
export type Paradigm =
  | 'deterministic-causal'
  | 'graph-free-deterministic'
  | 'llm-agent'
  | 'causal-discovery'
  | 'multimodal';

/**
 * Comparison cohort. Entries from *different* cohorts are measured on different
 * case sets and must never be compared directly — the single largest source of
 * false "SOTA" claims in this field.
 */
export type Cohort =
  /** All 9 RCAEval subsets (735 cases), service-level Top-1. */
  | 'rcaeval-full'
  /** RCAEval RE2 Online-Boutique (90 cases), where the LLM agents report. */
  | 'rcaeval-re2-ob'
  /** Single-system / single-slice results (not comparable to the full benchmark). */
  | 'rcaeval-single-system'
  /** Non-RCAEval benchmarks (AIOPS-2022, TrainTicket, FSE'26, ORCA-bench). */
  | 'cross-benchmark';

/** Provenance for a result we measured in this repository. */
export interface OursMeasuredProvenance {
  readonly kind: 'ours-measured';
  /** Commit that reproduces the measurement (the golden baseline). */
  readonly commit: string;
  /** Harness that produced the number. */
  readonly harness: string;
}

/** Provenance for a result taken from a published source. */
export interface PublishedProvenance {
  readonly kind: 'published';
  /** Human-readable venue (e.g. "arXiv:2601.21359 (WWW'25)"). */
  readonly source: string;
  /** arXiv identifier, when the source is an arXiv paper. */
  readonly arxivId?: string;
  /** DOI, when the source is a DOI-registered artifact. */
  readonly doi?: string;
}

/** A provenance discriminator union. */
export type Provenance = OursMeasuredProvenance | PublishedProvenance;

/** A single leaderboard cell. */
export interface LeaderboardEntry {
  /** Method / system name. */
  readonly method: string;
  /** Analysis paradigm. */
  readonly paradigm: Paradigm;
  /** Result in [0, 1] (percentage ÷ 100). */
  readonly result: number;
  /** Cohort this cell belongs to (defines the comparable case set). */
  readonly cohort: Cohort;
  /** Evaluation metric (e.g. "Top-1", "AC@1", "Recall@1", "PR@1"). */
  readonly metric: string;
  /** System, when the cell is system-scoped (e.g. "SockShop"); undefined = all. */
  readonly system?: string;
  /** Suite, when the cell is suite-scoped (e.g. "RE2", "overall"). */
  readonly suite?: string;
  /** Free-form clarification (e.g. LLM backbone, sample size). */
  readonly note?: string;
  /** Mandatory provenance. */
  readonly provenance: Provenance;
}

/** The complete, immutable leaderboard. */
export interface LeaderboardTable {
  /** Schema version of this table. */
  readonly version: string;
  /** ISO-8601 timestamp of generation. */
  readonly generatedAt: string;
  /** All cells. */
  readonly entries: readonly LeaderboardEntry[];
}

// ── Constants ─────────────────────────────────────────────

/** Schema version of {@link LeaderboardTable}. */
export const SOTA_LEADERBOARD_VERSION = '1.0.0';

/**
 * Stable validation issue codes, exported so tests (and callers) can assert on
 * them without stringly-typed literals.
 */
export const VALIDATION_CODES = {
  /** `result` is outside the closed interval [0, 1]. */
  resultOutOfRange: 'RESULT_OUT_OF_RANGE',
  /** `result` is exactly 0 — a claim of "never correct", worth a human look. */
  zeroResult: 'ZERO_RESULT',
  /** `method` is empty or whitespace. */
  emptyMethod: 'EMPTY_METHOD',
  /** `ours-measured` provenance is missing a reproducing commit. */
  missingCommit: 'MISSING_COMMIT',
  /** `published` provenance has a blank source. */
  missingSource: 'MISSING_SOURCE',
  /** `published` provenance has no arXiv id and no DOI (venue-only cite). */
  missingCitationId: 'MISSING_CITATION_ID',
  /** Two cells share the same (method, cohort, metric, system, suite) key. */
  duplicateEntry: 'DUPLICATE_ENTRY',
} as const;

export type ValidationCode = (typeof VALIDATION_CODES)[keyof typeof VALIDATION_CODES];

// ── Type guards ───────────────────────────────────────────

/** Narrows a {@link Provenance} to {@link OursMeasuredProvenance}. */
export function isOursMeasured(provenance: Provenance): provenance is OursMeasuredProvenance {
  return provenance.kind === 'ours-measured';
}

/** Narrows a {@link Provenance} to {@link PublishedProvenance}. */
export function isPublished(provenance: Provenance): provenance is PublishedProvenance {
  return provenance.kind === 'published';
}

// ── Validation ────────────────────────────────────────────

/** Severity of a validation issue. */
export type ValidationSeverity = 'error' | 'warning';

/** A single validation finding. */
export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly code: ValidationCode;
  readonly message: string;
  /** The offending entry, when the issue is tied to a specific cell. */
  readonly entry?: LeaderboardEntry;
}

/** The result of validating a leaderboard table. */
export interface ValidationReport {
  /** True when there are no `error`-severity issues (warnings are allowed). */
  readonly valid: boolean;
  /** All issues, errors first then warnings, in encounter order. */
  readonly issues: readonly ValidationIssue[];
}

/** True when the string is empty or only whitespace. */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** Build the uniqueness key for an entry. */
function entryKey(entry: LeaderboardEntry): string {
  const system = entry.system ?? '*';
  const suite = entry.suite ?? '*';
  return `${entry.method}\u0000${entry.cohort}\u0000${entry.metric}\u0000${system}\u0000${suite}`;
}

/**
 * Validate a leaderboard table for integrity.
 *
 * Checks (errors): result range, non-blank method, ours-measured commit,
 * published source (arXiv or DOI), duplicate cells. Checks (warning): a zero
 * result (a claim of "never correct" that merits a human look).
 *
 * @param table - The table to validate.
 * @returns A report whose `valid` is false iff any error-severity issue exists.
 */
export function validateLeaderboard(table: LeaderboardTable): ValidationReport {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const entry of table.entries) {
    if (isBlank(entry.method)) {
      issues.push({
        severity: 'error',
        code: VALIDATION_CODES.emptyMethod,
        message: 'entry has an empty method name',
        entry,
      });
    }

    if (!Number.isFinite(entry.result) || entry.result < 0 || entry.result > 1) {
      issues.push({
        severity: 'error',
        code: VALIDATION_CODES.resultOutOfRange,
        message: `result ${entry.result} for "${entry.method}" is outside [0, 1]`,
        entry,
      });
    } else if (entry.result === 0) {
      issues.push({
        severity: 'warning',
        code: VALIDATION_CODES.zeroResult,
        message: `"${entry.method}" claims a 0 result — confirm it is not a missing cell`,
        entry,
      });
    }

    if (isOursMeasured(entry.provenance)) {
      if (isBlank(entry.provenance.commit)) {
        issues.push({
          severity: 'error',
          code: VALIDATION_CODES.missingCommit,
          message: `"${entry.method}" is ours-measured but has no reproducing commit`,
          entry,
        });
      }
    } else {
      if (isBlank(entry.provenance.source)) {
        issues.push({
          severity: 'error',
          code: VALIDATION_CODES.missingSource,
          message: `"${entry.method}" is published but has a blank source`,
          entry,
        });
      }
      const hasId = entry.provenance.arxivId !== undefined || entry.provenance.doi !== undefined;
      if (!hasId) {
        issues.push({
          severity: 'warning',
          code: VALIDATION_CODES.missingCitationId,
          message: `"${entry.method}" is citeable by venue only (no arXiv id / DOI) — weak provenance`,
          entry,
        });
      }
    }

    const key = entryKey(entry);
    if (seen.has(key)) {
      issues.push({
        severity: 'error',
        code: VALIDATION_CODES.duplicateEntry,
        message: `duplicate cell for "${entry.method}" (${entry.cohort}, ${entry.metric})`,
        entry,
      });
    }
    seen.add(key);
  }

  issues.sort((a, b) => {
    const rank = (s: ValidationSeverity): number => (s === 'error' ? 0 : 1);
    return rank(a.severity) - rank(b.severity);
  });

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
  };
}

// ── Cohort scoping ────────────────────────────────────────

/**
 * Filter entries to a single cohort, optionally narrowed to one metric.
 *
 * This is the honest way to slice the leaderboard: never compare across cohorts.
 *
 * @param table - The table to filter.
 * @param cohort - The cohort to keep.
 * @param metric - Optional metric to further narrow (e.g. "Top-1").
 */
export function entriesByCohort(
  table: LeaderboardTable,
  cohort: Cohort,
  metric?: string,
): readonly LeaderboardEntry[] {
  return table.entries.filter(
    (entry) => entry.cohort === cohort && (metric === undefined || entry.metric === metric),
  );
}

// ── Comparison guard ──────────────────────────────────────

/**
 * Assert that two entries are comparable (same cohort, metric, and system) or
 * throw. This guard makes the strawman comparison — dividing an `rcaeval-full`
 * number by an `rcaeval-re2-ob` number — fail loudly.
 *
 * @throws {Error} When the entries are not comparable.
 */
export function requireComparable(a: LeaderboardEntry, b: LeaderboardEntry): void {
  if (a.cohort !== b.cohort) {
    throw new Error(
      `cannot compare "${a.method}" (${a.cohort}) with "${b.method}" (${b.cohort}): different cohorts`,
    );
  }
  if (a.metric !== b.metric) {
    throw new Error(
      `cannot compare "${a.method}" (${a.metric}) with "${b.method}" (${b.metric}): different metrics`,
    );
  }
  if (a.system !== b.system) {
    throw new Error(
      `cannot compare "${a.method}" (${a.system ?? 'all'}) with "${b.method}" (${
        b.system ?? 'all'
      }): different systems`,
    );
  }
}

/** A pairwise margin, expressed both as a ratio and a percentage-point gap. */
export interface EntryMargin {
  /** `a.result / b.result` (multiplicative margin). */
  readonly ratio: number;
  /** `(a.result - b.result) * 100` (additive margin in percentage points). */
  readonly ppGap: number;
}

/**
 * Compute the margin of `a` over `b` on a comparable basis.
 *
 * @throws {Error} When the entries are not comparable, or when `b.result` is 0
 *   (a ratio against a zero denominator is undefined).
 */
export function marginTo(a: LeaderboardEntry, b: LeaderboardEntry): EntryMargin {
  requireComparable(a, b);
  if (b.result === 0) {
    throw new Error(`cannot compute a margin against "${b.method}" with a zero result`);
  }
  return {
    ratio: a.result / b.result,
    ppGap: (a.result - b.result) * 100,
  };
}

// ── Canonical data ────────────────────────────────────────

const OUR_COMMIT = '80709c2';

/** Micro-Kinetic's own cells, measured in this repository. */
function oursEntries(): readonly LeaderboardEntry[] {
  return [
    {
      method: 'Micro-Kinetic',
      paradigm: 'deterministic-causal',
      result: 0.774,
      cohort: 'rcaeval-full',
      metric: 'Top-1',
      suite: 'overall',
      note: '735 cases, all 9 subsets; deterministic, sub-second, zero API cost',
      provenance: { kind: 'ours-measured', commit: OUR_COMMIT, harness: 'rcaeval-loader' },
    },
    {
      method: 'Micro-Kinetic',
      paradigm: 'deterministic-causal',
      result: 0.824,
      cohort: 'rcaeval-re2-ob',
      metric: 'AC@1',
      suite: 'RE2',
      system: 'OnlineBoutique',
      note: '90 cases',
      provenance: { kind: 'ours-measured', commit: OUR_COMMIT, harness: 'rcaeval-loader' },
    },
  ];
}

/**
 * Build the canonical SOTA leaderboard.
 *
 * All published cells below are taken from the primary sources cited in
 * `docs/sota-comparison.md` (v3). This is the only place those numbers live in
 * code — regenerate the doc/paper from this table after any readback change.
 *
 * @param generatedAt - ISO-8601 generation timestamp (injected for determinism).
 * @returns A frozen {@link LeaderboardTable}.
 */
export function createSotaLeaderboard(generatedAt: string): LeaderboardTable {
  const entries: readonly LeaderboardEntry[] = [
    ...oursEntries(),

    // ── rcaeval-full (735 cases, Top-1) ───────────────────
    {
      method: 'PRISM',
      paradigm: 'graph-free-deterministic',
      result: 0.68,
      cohort: 'rcaeval-full',
      metric: 'Top-1',
      note: 'Graph-free internal/external property decomposition; Top-3 91%, Avg@5 87%; 8 ms/diagnosis',
      provenance: {
        kind: 'published',
        source: "Pham, 'Graph-Free Root Cause Analysis'",
        arxivId: '2601.21359',
      },
    },
    {
      method: 'BARO',
      paradigm: 'causal-discovery',
      result: 0.19,
      cohort: 'rcaeval-full',
      metric: 'Top-1',
      note: 'Best pre-LLM causal method; its often-quoted 0.69 is TT-RE2 Avg@5, not overall Top-1',
      provenance: {
        kind: 'published',
        source: "RCAEval (WWW'25) baseline",
        arxivId: '2412.17015',
      },
    },

    // ── rcaeval-re2-ob (90 cases, AC@1) ───────────────────
    {
      method: 'RCLAgent (Qwen-3.6-Plus)',
      paradigm: 'llm-agent',
      result: 0.5667,
      cohort: 'rcaeval-re2-ob',
      metric: 'AC@1',
      system: 'OnlineBoutique',
      note: 'Multi-agent recursion-of-thought',
      provenance: { kind: 'published', source: 'Zhang et al. (PKU/Huawei)', arxivId: '2605.14866' },
    },
    {
      method: 'RCLAgent (Claude-3.5-Sonnet)',
      paradigm: 'llm-agent',
      result: 0.5231,
      cohort: 'rcaeval-re2-ob',
      metric: 'AC@1',
      system: 'OnlineBoutique',
      note: 'Multi-agent recursion-of-thought',
      provenance: { kind: 'published', source: 'Zhang et al. (PKU/Huawei)', arxivId: '2605.14866' },
    },
    {
      method: 'GALA',
      paradigm: 'llm-agent',
      result: 0.4222,
      cohort: 'rcaeval-re2-ob',
      metric: 'AC@1',
      system: 'OnlineBoutique',
      note: 'Agentic ReAct; 45.59% R@1',
      provenance: { kind: 'published', source: 'Tian et al.', arxivId: '2508.12472' },
    },
    {
      method: 'mABC',
      paradigm: 'llm-agent',
      result: 0.3998,
      cohort: 'rcaeval-re2-ob',
      metric: 'AC@1',
      system: 'OnlineBoutique',
      note: 'Multi-agent majority voting',
      provenance: { kind: 'published', source: 'mABC', arxivId: '2404.12135' },
    },
    {
      method: 'RCAgent',
      paradigm: 'llm-agent',
      result: 0.2532,
      cohort: 'rcaeval-re2-ob',
      metric: 'AC@1',
      system: 'OnlineBoutique',
      note: 'ReAct + tools',
      provenance: { kind: 'published', source: 'RCAgent', arxivId: '2310.16340' },
    },
    {
      method: 'OpenRCA',
      paradigm: 'llm-agent',
      result: 0.15,
      cohort: 'rcaeval-re2-ob',
      metric: 'AC@1',
      system: 'OnlineBoutique',
      note: 'Approximate figure; venue-only provenance (no arXiv id recorded)',
      provenance: { kind: 'published', source: "OpenRCA (ICLR'25), Xu et al." },
    },

    // ── rcaeval-single-system ─────────────────────────────
    {
      method: 'StableRCA',
      paradigm: 'graph-free-deterministic',
      result: 0.77,
      cohort: 'rcaeval-single-system',
      metric: 'Top-1',
      system: 'SockShop',
      note: 'Robust graph-agnostic mechanism-level RCA',
      provenance: { kind: 'published', source: 'Lin et al.', arxivId: '2606.05636' },
    },
    {
      method: 'MARLIN',
      paradigm: 'deterministic-causal',
      result: 0.611,
      cohort: 'rcaeval-single-system',
      metric: 'PR@1',
      system: 'OnlineBoutique',
      provenance: { kind: 'published', source: 'sota2.com (Mar 2026)' },
    },
    {
      method: 'DynaCausal',
      paradigm: 'multimodal',
      result: 0.63,
      cohort: 'rcaeval-single-system',
      metric: 'AC@1',
      note: 'Averaged over mixed public benchmarks, not RCAEval-only',
      provenance: { kind: 'published', source: 'Zhang et al. (CUHK-SZ)', arxivId: '2510.22613' },
    },

    // ── cross-benchmark ───────────────────────────────────
    {
      method: 'RCLAgent',
      paradigm: 'llm-agent',
      result: 0.6515,
      cohort: 'cross-benchmark',
      metric: 'Recall@1',
      system: 'AIOPS-2022',
      note: 'Distinct from AIOps2025 (AgenticOpsEval)',
      provenance: { kind: 'published', source: 'Zhang et al. (PKU/Huawei)', arxivId: '2605.14866' },
    },
    {
      method: 'RCLAgent',
      paradigm: 'llm-agent',
      result: 0.8235,
      cohort: 'cross-benchmark',
      metric: 'Recall@1',
      system: 'Augmented-TrainTicket',
      note: "The authors' own augmentation of TrainTicket",
      provenance: { kind: 'published', source: 'Zhang et al. (PKU/Huawei)', arxivId: '2605.14866' },
    },
    {
      method: "FSE'26 best-of-11",
      paradigm: 'multimodal',
      result: 0.37,
      cohort: 'cross-benchmark',
      metric: 'Top@1-best',
      system: 'FSE26-fault-propagation',
      note: 'Best of 11 re-evaluated SOTA models on the hard benchmark',
      provenance: { kind: 'published', source: "Fang et al. (FSE'26)", arxivId: '2510.04711' },
    },
    {
      method: "FSE'26 avg-of-11",
      paradigm: 'multimodal',
      result: 0.21,
      cohort: 'cross-benchmark',
      metric: 'Top@1-avg',
      system: 'FSE26-fault-propagation',
      note: 'Average of 11 re-evaluated SOTA models on the hard benchmark',
      provenance: { kind: 'published', source: "Fang et al. (FSE'26)", arxivId: '2510.04711' },
    },
    {
      method: 'ORCA frontier agents',
      paradigm: 'llm-agent',
      result: 0.253,
      cohort: 'cross-benchmark',
      metric: 'accuracy',
      system: 'Astronomy-Shop',
      note: 'Medium tasks; Hard = 10.0%; 7–40% hallucinated root causes',
      provenance: {
        kind: 'published',
        source: 'ORCA-bench (Cornell Tech/Traversal)',
        arxivId: '2607.28545',
      },
    },
  ];

  return Object.freeze({
    version: SOTA_LEADERBOARD_VERSION,
    generatedAt,
    entries: Object.freeze(entries),
  });
}
