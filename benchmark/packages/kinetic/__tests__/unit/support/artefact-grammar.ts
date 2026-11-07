/**
 * The artefact grammar — what counts as a reference to somebody else's work, in Markdown.
 *
 * ## Why this is one module and not a copy per fence
 *
 * Two fences now read the same population: `competitor-artefact-availability.test.ts` asks whether an
 * artefact RESOLVES, and `sota-population-claims.test.ts` asks which POPULATION a reference reports on. If
 * each held its own regex they would agree only until one of them was edited, and the register's law 7 is
 * exactly that: *a fence between two copies holds them to each other and to nothing else*. The population
 * they share is derived HERE, once.
 *
 * ## The hosting shape that was outside the population
 *
 * The grammar had four alternatives — an `arXiv:` id, a `github.com/OWNER/REPO` URL, a `10.…/zenodo.…` DOI
 * and a backticked `OWNER/REPO`. A **project page on `OWNER.github.io`** matched none of them, and that is
 * the one hosting shape a method-less artefact uses: `arXiv:2610.05009` prints
 * `luoyu100.github.io/projects/toolrca/project` in its own header, that page resolves, and it carries no
 * code, no weights, no dataset link and no per-case results. **An inventory cannot judge an artefact its
 * grammar cannot see** — the register's law 18, one hosting shape over: a fence's population is its subject,
 * and a subject written in a URL form the reader does not know is not a smaller population but a blind one.
 *
 * @module __tests__/unit/support/artefact-grammar
 */

/**
 * Every grammar that names somebody else's artefact.
 *
 * The backticked `OWNER/REPO` shorthand is the only alternative with a capture group, so `m[1]` is the
 * token when that alternative matched and `m[0]` otherwise.
 */
export const ARTEFACT_TOKEN =
  /arXiv:\d{4}\.\d{4,5}|github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9][A-Za-z0-9-]*\.github\.io\/[A-Za-z0-9/._-]*[A-Za-z0-9._-]|10\.\d{4,}\/zenodo\.\d+|`([a-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+)`/g;

/** This repository's own top-level directories: a backticked path into one of these is not an artefact. */
export const OWN_PATH_PREFIXES = [
  'docs/',
  'scripts/',
  'packages/',
  'benchmarks/',
  'integration-tests/',
  '.github/',
];

/**
 * The two shapes a backticked slash form may have to count as somebody else's artefact.
 *
 * The shorthand is the one alternative that must GUESS, because `OWNER/REPO` and a score written with a slash
 * are the same characters: the moment `docs/sota-comparison.md` started quoting its own cells as `` `75/90` ``,
 * this census reported five artefacts nobody had ever heard of and asked the inventory for a row about a
 * fraction. Length and shape cannot separate them, so the rule names the two things the shorthand is FOR:
 *
 * - **a repository path**, which contains a letter (`edgedelta/project-arena`, `a1/b2`);
 * - **a short DOI**, which begins `10.` and a registrant number (`10.1145/3808137`) and has no letter at all —
 *   which is why "a path contains a letter" could not have been the rule.
 *
 * A ratio is neither. The trade-off is stated rather than hidden: a purely numeric GitHub repository would now
 * be invisible to the shorthand. Numeric owner/repo pairs are legal on GitHub and no artefact this record cites
 * is one, so the cost is theoretical while the false positive was measured — and the fence asserts that every
 * REGISTERED token is one of these two shapes, so a third would have to be decided in the open.
 */
const SHORTHAND_SHAPES = /[A-Za-z]|^10\.\d{4,}\//;

/**
 * Every artefact token in `text`, in first-appearance order.
 *
 * @param text - Markdown source.
 * @returns The distinct tokens, bare (no backticks).
 */
export function artefactTokens(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(ARTEFACT_TOKEN)) {
    const token = m[1] ?? m[0];
    if (m[1] !== undefined && OWN_PATH_PREFIXES.some((p) => token.startsWith(p))) continue;
    // Only the guessed alternative is filtered: the four unambiguous grammars (`arXiv:`, `github.com/`, a
    // `github.io` page, a Zenodo DOI) already state what they are.
    if (m[1] !== undefined && !SHORTHAND_SHAPES.test(token)) continue;
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

/**
 * The sentences of a markdown document, with hard wrapping flattened first.
 *
 * Flattening is required, not cosmetic: both documents are wrapped at ~100 columns, so a claim and the
 * token it is about land on different LINES — which is exactly why the DecompRCA defect survived a
 * line-oriented reading, and why a rule that reads a line cannot see a gap assertion whose subject is in
 * the header above it.
 *
 * @param text - Markdown source.
 * @returns The sentences, whitespace-normalised.
 */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;])\s+(?=[A-Z*`"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
