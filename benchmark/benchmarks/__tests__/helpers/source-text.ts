/**
 * Source text with its comments removed, for fences that assert on what a file SAYS.
 *
 * ## Why this exists
 *
 * A fence that asserts on file text is satisfied — or defeated — by the comments that explain the defect,
 * and this repository has paid for it twice in consecutive iterations:
 *
 * - `benchmark-rcaeval-trigger`'s sampler check read the whole workflow file, so **the comment explaining
 *   why `--max-cases` was removed** made `benchmark-rcaeval.yml` a member of its own sampler list;
 * - `ablation-engine-options`'s absence fence for the falsified AVG/CW parenthetical matched **the comment
 *   quoting that parenthetical**, and then the replacement constant's block JSDoc.
 *
 * Both were assertions about a string, published as assertions about a statement. Stripping first makes a
 * text assertion an assertion about the CODE — so a comment may quote, name or explain a defect without
 * defeating the guard against it, which is the case the guard exists for.
 *
 * ## What it strips, and what it deliberately does not
 *
 * Block comments (the JSDoc and the C-style forms alike) are removed whole. For the line form, only
 * **whole-line** open-comment lines are dropped: a trailing comment on a code line survives, and a
 * double-slash inside a string literal (a URL, a path) cannot be mangled into a syntax change.
 *
 * Shared rather than copied, for the reason `engine-interfaces.ts` gives one directory over: two guards
 * each carrying their own stripper are two answers to "what does this file say", and this repository has
 * already paid once for holding two answers to one question.
 *
 * @module benchmarks/__tests__/helpers/source-text
 */

/**
 * Remove block comments and whole-line `//` comments from source text.
 *
 * @param src - The file's text.
 * @returns The same text without comments.
 */
export const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
