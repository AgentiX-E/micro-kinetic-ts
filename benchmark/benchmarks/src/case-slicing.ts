/**
 * Memory slicing for the RCAEval runner.
 *
 * A cell of this corpus is up to 125 cases and the cases are not the same size — on RE2 the per-case corpus bytes
 * average **23 MB** on SockShop, **80 MB** on OnlineBoutique and **245 MB** on TrainTicket, with a TrainTicket
 * maximum of 401 MB. A slice bounded by a case COUNT therefore bounds nothing: sixteen TrainTicket cases are 3.9 GB
 * of CSV before a single object is allocated, which is the whole V8 heap. The full 723-case run was killed twice —
 * once by the cgroup OOM killer at 6.9 GB resident, once by V8 at its own 4 GB heap limit — and both times inside
 * the first TrainTicket slice.
 *
 * What makes slicing legitimate is that a cell's grouping is STATISTICAL rather than simultaneous: its rate is a
 * fold over its cases and no case's verdict reads another's. So the unit of residence can be a slice, and the
 * aggregate is what crosses the boundary — provided the fold is exact, which is what `mergeRunResults` and
 * `mergeLoadStats` are for.
 *
 * @module benchmarks/case-slicing
 */

/**
 * How many bytes of corpus files one slice may hold.
 *
 * A BUDGET rather than a count, because the corpus is heterogeneous by an order of magnitude per case. Parsed
 * residency tracks corpus bytes closely on this data — a 85 MB case measures 75 MB of heap once assembled — so half
 * a gigabyte of CSV is about half a gigabyte of heap, which leaves the engine's graph and embedding state the rest
 * of the container.
 *
 * Not a dispatchable knob: the count beside it is already adjustable for throughput, and this one is a SAFETY
 * bound. An arm that could raise it could OOM the run it is trying to measure, and would report the failure as a
 * corpus property.
 */
export const SLICE_BYTE_BUDGET = 512 * 1024 * 1024;

/**
 * Split a cell's cases into memory-sized slices.
 *
 * Two bounds apply at once and the earlier one closes the slice: at most `chunk` cases, and at most
 * {@link SLICE_BYTE_BUDGET} corpus bytes. A single case larger than the byte budget becomes its own slice rather
 * than being skipped or split — the corpus's largest case is 401 MB, so this is reachable, and a runner that
 * silently dropped it would report a cell over a population that was not the cell.
 *
 * `chunk <= 0` yields one slice holding everything: the pre-slicing shape, so a dispatch can reproduce the old peak
 * as a control. The fold of a single slice is that slice.
 *
 * The concatenation of the result is always `metas`, in order, with no case dropped or repeated — the invariant
 * every fold downstream depends on.
 *
 * @param metas - The cell's cases, in corpus order.
 * @param chunk - Maximum cases per slice; `0` for no count bound.
 * @param sizeOf - A case's corpus bytes, or `0` when they cannot be measured.
 * @returns Non-empty slices of cases, in corpus order.
 */
export function sliceForMemory<T>(
  metas: readonly T[],
  chunk: number,
  sizeOf: (meta: T) => number,
): ReadonlyArray<readonly T[]> {
  // A NaN chunk reaches here from a parser that did not check, and `metas.length <= NaN` is false, so the guard has
  // to be "not a positive number" rather than "less than or equal to zero".
  const countBound = Number.isFinite(chunk) && chunk > 0;
  if (!countBound) return [metas];

  const slices: T[][] = [];
  let current: T[] = [];
  let bytes = 0;

  for (const meta of metas) {
    const size = sizeOf(meta);
    const full =
      current.length > 0 && (current.length >= chunk || bytes + size > SLICE_BYTE_BUDGET);
    if (full) {
      slices.push(current);
      current = [];
      bytes = 0;
    }
    current.push(meta);
    bytes += size;
  }
  if (current.length > 0) slices.push(current);

  // An empty cell still needs one slice, for the caller whose loop is `for (const slice of slices)`: no slices would
  // skip the cell without a word, and one empty slice reports it as a cell that held nothing, which is the truth.
  return slices.length > 0 ? slices : [[]];
}
