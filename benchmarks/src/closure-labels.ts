/**
 * Cloud-OpsBench's closure labels — the input format, pinned before anything is scored with it.
 *
 * ## Why this file exists at all
 *
 * `docs/sota-comparison.md` names one metric axis it does not score: whether an answer was supported by the
 * evidence the agent actually collected. `arXiv:2603.00468` publishes exactly that, jointly with the root cause,
 * over 754 runtime-verified cases on two of our own systems — so the axis can be **adopted from a competitor's
 * labels instead of invented here**, which is cheaper than every other route this programme has.
 *
 * Adoption has one precondition that is nobody's opinion: their label files parse, and a milestone's evidence
 * requirement is the kind of thing our artifact can answer. Both are properties of THEIR format, which we do not
 * control and which can change under us. So the format is pinned by tests here, and a change fails in CI rather
 * than silently mis-scoring a corpus.
 *
 * ## What the format turned out to be, measured over all 754 cases
 *
 * | | count |
 * | --- | ---: |
 * | cases | **754** (`boutique` 550, `trainticket` 204) |
 * | `fault_object` scoped to a **service** (`app/<name>`) | **659** (87.4 %) |
 * | …scoped to a **node** | 48 (6.4 %) |
 * | …scoped to a **namespace** | 47 (6.2 %) |
 * | milestones | **2 478**, i.e. 2–5 a case (2: 95, 3: 392, 4: 223, 5: 44) |
 * | admissible tool uses | 6 654, of which **473 are argument-free** and **1 098 carry `evidence_patterns`** |
 *
 * **Only 473 of 2 478 milestones (19.1 %) can be judged from a tool NAME.** 76 cases have every milestone at
 * that level, 306 have some, and **372 need the arguments for every milestone**. Our artifact records
 * `tools: Record<string, number>` — names and counts, no arguments — so the closure axis is adoptable for 76 of
 * 754 cases today and needs one recorded field (the per-call argument) for the other 678.
 *
 * That number is the reason this module stops where it does. It scores at name level, which is what the artifact
 * can support, and it reports the scorable denominator beside the score so a reading of `76 %` can never be
 * mistaken for `76 %` of the corpus.
 *
 * ## What the scope split means for a comparison
 *
 * `659` of `754` root causes name a **service**, which is this engine's own granularity: their `fault_object`
 * `app/adservice` and our accepted set `{adservice}` are the same object, and the only step between them is
 * stripping the `app/` prefix. The other **95** name a node or a namespace, and this engine cannot express either
 * as an answer — not because it is wrong, but because its output alphabet is services. A side-by-side that
 * averaged over all 754 would therefore charge us for 95 cases we cannot answer by construction, which is the
 * population defect this record has refused four times before; the census reports the two subsets separately and
 * never a single blended figure.
 *
 * @module benchmarks/src/closure-labels
 */
import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';

/** What a case says its root cause is, at the granularity its own label uses. */
export type LabelScope =
  | { readonly kind: 'service'; readonly service: string }
  | { readonly kind: 'node' }
  | { readonly kind: 'namespace' }
  /** A prefix this file has never seen. Counted rather than bucketed, so an unseen scope is a number. */
  | { readonly kind: 'other'; readonly raw: string };

/** One admissible tool use inside a milestone. */
export interface ClosureToolUse {
  readonly tool: string;
  /** The argument object's keys, sorted, so a digest is comparable without keeping the values. */
  readonly argumentKeys: readonly string[];
  readonly evidencePatterns: readonly string[];
}

/** One milestone: what evidence a case's answer implies, and which calls would count as it. */
export interface ClosureMilestone {
  readonly id: string;
  readonly role: string;
  readonly uses: readonly ClosureToolUse[];
}

/** One case's label, in the shape the corpus actually carries. */
export interface ClosureLabel {
  readonly caseId: string;
  readonly namespace: string;
  readonly faultTaxonomy: string;
  readonly faultObject: string;
  readonly rootCause: string;
  readonly milestones: readonly ClosureMilestone[];
}

/** A parse outcome: the label, or the field that refused it. */
export type ClosureParse =
  | { readonly ok: true; readonly label: ClosureLabel }
  | { readonly ok: false; readonly reason: string };

/**
 * The scope a `fault_object` names.
 *
 * Three prefixes appear in the corpus and each means something different for comparability, which is why this
 * returns a union rather than a stripped string: `app/<service>` is our own answer alphabet, `node/…` and
 * `namespace/…` are not, and a comparison that lost the distinction would silently charge this engine for
 * cases whose truth it cannot express.
 *
 * @param faultObject - The label's `result.fault_object`, e.g. `app/adservice`.
 * @returns The scope, with the service name when there is one.
 */
export function labelScope(faultObject: string): LabelScope {
  const cut = faultObject.indexOf('/');
  if (cut <= 0) return { kind: 'other', raw: faultObject };
  const prefix = faultObject.slice(0, cut);
  const rest = faultObject.slice(cut + 1);
  if (rest === '') return { kind: 'other', raw: faultObject };
  if (prefix === 'app') return { kind: 'service', service: rest };
  if (prefix === 'node') return { kind: 'node' };
  if (prefix === 'namespace') return { kind: 'namespace' };
  return { kind: 'other', raw: faultObject };
}

/**
 * Whether a milestone can be judged from a tool NAME alone.
 *
 * True when some admissible use is argument-free AND carries no evidence pattern: such a use is satisfied by
 * the call's existence, and our artifact records exactly that. A milestone with one argument-free use among
 * several is still name-level scorable — the requirement is "did any admissible call happen", so one
 * satisfiable branch is enough.
 *
 * @param milestone - One label milestone.
 * @returns Whether a name-only artifact can decide it.
 */
export function nameLevelScorable(milestone: ClosureMilestone): boolean {
  return milestone.uses.some(
    (use) => use.argumentKeys.length === 0 && use.evidencePatterns.length === 0,
  );
}

/** The corpus census, as numbers a report can quote without re-deriving them. */
export interface ClosureCensus {
  readonly cases: number;
  readonly byScope: Readonly<Record<LabelScope['kind'], number>>;
  readonly milestones: number;
  readonly nameLevelMilestones: number;
  readonly casesAllNameLevel: number;
  readonly casesSomeNameLevel: number;
  readonly casesNoneNameLevel: number;
  readonly uses: {
    readonly total: number;
    readonly argumentFree: number;
    readonly withArguments: number;
    readonly withPatterns: number;
  };
  /** Tool name → admissible-use count, most frequent first, ties by name. */
  readonly tools: readonly (readonly [string, number])[];
}

/**
 * The closure score an artifact can carry TODAY, and the denominator it is a fraction of.
 *
 * `mapTool` is the semantic step and it is a parameter rather than a table because the two tool surfaces have
 * nothing in common syntactically: theirs is twelve MCP calls (`GetResources`, `DescribeResource`,
 * `CheckServiceConnectivity`, …) and ours is four telemetry queries. One of ours can be evidence for several of
 * theirs, which is why it returns a list. A call that maps to nothing contributes nothing — the alternative, a
 * default mapping, would score a milestone on a tool nobody claimed was related to it.
 *
 * @param label - The case's label.
 * @param called - The tool names our artifact records, as a set.
 * @param mapTool - Our tool name → the competitor tools it is evidence for.
 * @returns Satisfied milestones, the scorable subset's size, and the case's total.
 */
export function nameLevelClosure(
  label: ClosureLabel,
  called: ReadonlySet<string>,
  mapTool: (ours: string) => readonly string[],
): { readonly satisfied: number; readonly scorable: number; readonly total: number } {
  const reachable = new Set<string>();
  for (const tool of called) for (const theirs of mapTool(tool)) reachable.add(theirs);
  let satisfied = 0;
  let scorable = 0;
  for (const milestone of label.milestones) {
    if (!nameLevelScorable(milestone)) continue;
    scorable += 1;
    if (milestone.uses.some((use) => reachable.has(use.tool))) satisfied += 1;
  }
  return { satisfied, scorable, total: label.milestones.length };
}

/**
 * Read one `milestone.json`.
 *
 * Refuses rather than coerces, and names the field: a label whose `result` is missing would otherwise become a
 * case with an empty root cause that scores as a miss, which is a wrong number attributed to the engine.
 *
 * @param text - The file's contents.
 * @param caseId - The case's path-derived id, used when the file's own `case_id` is absent.
 * @returns The label, or the reason it was refused.
 */
export function parseClosureLabel(text: string, caseId: string): ClosureParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `${caseId}: not JSON (${(error as Error).message})` };
  }
  if (typeof raw !== 'object' || raw === null)
    return { ok: false, reason: `${caseId}: not an object` };
  const record = raw as Record<string, unknown>;
  const result = record.result as Record<string, unknown> | undefined;
  if (typeof result !== 'object' || result === null)
    return { ok: false, reason: `${caseId}: no result` };
  const faultObject = result.fault_object;
  const faultTaxonomy = result.fault_taxonomy;
  const rootCause = result.root_cause;
  if (typeof faultObject !== 'string' || faultObject === '') {
    return { ok: false, reason: `${caseId}: no result.fault_object` };
  }
  if (typeof faultTaxonomy !== 'string' || faultTaxonomy === '') {
    return { ok: false, reason: `${caseId}: no result.fault_taxonomy` };
  }
  if (typeof rootCause !== 'string' || rootCause === '') {
    return { ok: false, reason: `${caseId}: no result.root_cause` };
  }
  const milestones = record.milestones;
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { ok: false, reason: `${caseId}: no milestones` };
  }
  const parsed: ClosureMilestone[] = [];
  for (const [index, entry] of milestones.entries()) {
    const milestone = entry as Record<string, unknown>;
    const uses = milestone.admissible_tool_uses;
    if (!Array.isArray(uses) || uses.length === 0) {
      return { ok: false, reason: `${caseId}: milestone ${index} has no admissible_tool_uses` };
    }
    parsed.push({
      id: String(milestone.id ?? `M${index + 1}`),
      role: String(milestone.role ?? ''),
      uses: uses.map((use) => {
        const one = use as Record<string, unknown>;
        const args = one.arguments;
        return {
          tool: String(one.tool_name ?? ''),
          argumentKeys: typeof args === 'object' && args !== null ? Object.keys(args).sort() : [],
          evidencePatterns: Array.isArray(one.evidence_patterns)
            ? one.evidence_patterns.map((pattern) => String(pattern))
            : [],
        };
      }),
    });
  }
  const namespace = typeof record.namespace === 'string' ? record.namespace : '';
  return {
    ok: true,
    label: {
      caseId: typeof record.case_id === 'string' ? record.case_id : caseId,
      namespace,
      faultTaxonomy,
      faultObject,
      rootCause,
      milestones: parsed,
    },
  };
}

/**
 * The census over a corpus of labels.
 *
 * The three "cases" counts are the whole point and are deliberately not collapsed into a mean: a corpus in which
 * every case is name-level scorable and one in which a tenth are support two completely different claims about
 * what the artifact can be scored on, and the mean hides that difference.
 *
 * @param labels - Every label the corpus carries.
 * @returns The counts, ready to be quoted.
 */
export function summariseCorpus(labels: readonly ClosureLabel[]): ClosureCensus {
  const byScope = { service: 0, node: 0, namespace: 0, other: 0 };
  const tools = new Map<string, number>();
  let milestones = 0;
  let nameLevelMilestones = 0;
  let casesAllNameLevel = 0;
  let casesSomeNameLevel = 0;
  let casesNoneNameLevel = 0;
  const uses = { total: 0, argumentFree: 0, withArguments: 0, withPatterns: 0 };
  for (const label of labels) {
    byScope[labelScope(label.faultObject).kind] += 1;
    let nameLevel = 0;
    for (const milestone of label.milestones) {
      milestones += 1;
      if (nameLevelScorable(milestone)) nameLevel += 1;
      for (const use of milestone.uses) {
        uses.total += 1;
        if (use.argumentKeys.length === 0) uses.argumentFree += 1;
        else uses.withArguments += 1;
        if (use.evidencePatterns.length > 0) uses.withPatterns += 1;
        tools.set(use.tool, (tools.get(use.tool) ?? 0) + 1);
      }
    }
    nameLevelMilestones += nameLevel;
    if (nameLevel === label.milestones.length) casesAllNameLevel += 1;
    else if (nameLevel === 0) casesNoneNameLevel += 1;
    else casesSomeNameLevel += 1;
  }
  return {
    cases: labels.length,
    byScope,
    milestones,
    nameLevelMilestones,
    casesAllNameLevel,
    casesSomeNameLevel,
    casesNoneNameLevel,
    uses,
    // The histogram's order comes from the repository's ONE order convention, not from a comparator here: a
    // `localeCompare` would make a published table's row order a property of the machine's ICU version, which is
    // the exact defect `packages/kinetic/src/benchmarks/case-order.ts` exists to prevent.
    tools: [...tools.entries()].sort(([a, na], [b, nb]) => nb - na || compareCasePaths(a, b)),
  };
}
