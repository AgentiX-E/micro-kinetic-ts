/**
 * A byte-level RFC 4180 record reader for the CSV files an RCAEval case ships.
 *
 * ## Why not `readFileSync(path, 'utf-8').split('\n')`
 *
 * Two defects, one of which is invisible and the other of which is invisible
 * *and* costs gigabytes.
 *
 * **Truncation.** RCAEval's SockShop/OnlineBoutique `logs.csv` carries JSON log
 * messages, so the message cell is quoted and contains commas:
 *
 * ```
 * 1705595459,front-end,"Posting Address: {""number"":""123"",""city"":""x""}"
 * ```
 *
 * A `split(',')` reader cuts that cell at the first comma INSIDE the quotes and
 * hands the remainder to columns that do not exist. The log channels then rank
 * on a prefix of the message — no error, no warning, and every message-derived
 * signal (severity, stack-trace shape, exception class) computed from text the
 * author of the file never wrote. This reader unescapes `""` and keeps quoted
 * commas and newlines inside the cell they belong to.
 *
 * **Retention.** A whole-file decode produces ONE string the size of the file
 * (181 MB for the largest TrainTicket case). Substrings of it are V8
 * *SlicedString*s that keep the whole parent alive, so a single retained
 * exception name — a 22-character slice — pins the entire 181 MB document for
 * the life of the process. Measured on the RE2 SockShop cell: 90 cases retained
 * 1395 MB of log text *after* the cases themselves were dropped and the
 * collector was run, because the cell keeps a handful of names extracted from
 * each log. Decoding each CELL separately instead makes every produced string
 * independent of every other, so what survives a case is bounded by what it
 * actually quotes.
 *
 * ## The iterator is lazy on purpose
 *
 * Records are produced one at a time and the scan stops at `maxRecords`, so a
 * caller that wants the first 10 000 spans of a million-span `traces.csv` never
 * walks the rest of the file.
 *
 * @module benchmarks/loaders/csv-records
 */

const COMMA = 0x2c;
const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;

/** Options for {@link readCsvRecords}. */
export interface CsvRecordOptions {
  /**
   * Maximum number of DATA records to yield. The header is never counted
   * against it and is always yielded, so `0` returns the header alone.
   */
  maxRecords?: number;
}

/**
 * Read a CSV document as a sequence of records, header first.
 *
 * Semantics, chosen to match what the loaders already do with these files:
 *
 * - the FIRST yielded record is the header, with a UTF-8 BOM stripped from its
 *   first cell;
 * - unquoted cells are trimmed; quoted cells are not (the quotes are the
 *   author's assertion that the spacing matters);
 * - `""` inside a quoted cell is one literal quote, and a quoted cell may span
 *   newlines;
 * - blank lines are skipped rather than yielded as a one-cell record — a
 *   trailing newline is a terminator, not a row;
 * - a ragged record is yielded as-is; padding to the header's width is the
 *   caller's decision because only the caller knows which columns it reads.
 *
 * An unterminated quoted cell ends at the end of the buffer instead of throwing:
 * a truncated file is a real input (a killed download), and the rows read before
 * the truncation are still evidence.
 *
 * @param source - The document's bytes. A `Buffer` rather than a string is the
 *   point of the API: see the module docblock on retention.
 * @param options - See {@link CsvRecordOptions}.
 * @yields Each record as its cells, header first.
 */
export function* readCsvRecords(
  source: Buffer,
  options: CsvRecordOptions = {},
): Generator<readonly string[], void, undefined> {
  const end = source.length;
  const limit = options.maxRecords ?? Number.POSITIVE_INFINITY;
  let pos = hasUtf8Bom(source) ? 3 : 0;
  let dataRecords = 0;
  let headerPending = true;

  while (pos < end) {
    // The cap is checked BEFORE the read it would forbid, so a capped read of a
    // million-record file stops at the cap instead of one record past it.
    if (!headerPending && dataRecords >= limit) return;

    const record = readOneRecord(source, pos);
    pos = record.next;

    // A blank line: the field scan produced exactly one empty unquoted cell.
    if (record.cells.length === 1 && record.cells[0] === '') continue;

    if (headerPending) {
      headerPending = false;
      yield record.cells;
      continue;
    }

    dataRecords += 1;
    yield record.cells;
  }
}

/** True when the document starts with a UTF-8 byte-order mark. */
function hasUtf8Bom(source: Buffer): boolean {
  return source.length >= 3 && source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf;
}

/**
 * Read one record starting at `from`.
 *
 * @param source - The document's bytes.
 * @param from - Offset of the record's first cell.
 * @returns The record's cells and the offset just past its terminator.
 */
function readOneRecord(source: Buffer, from: number): { cells: string[]; next: number } {
  const end = source.length;
  const cells: string[] = [];
  let pos = from;

  for (;;) {
    if (source[pos] === QUOTE) {
      const quoted = readQuotedCell(source, pos);
      cells.push(quoted.value);
      pos = quoted.next;
    } else {
      const stop = nextSeparator(source, pos);
      cells.push(source.toString('utf8', pos, stop).trim());
      pos = stop;
    }

    if (pos < end && source[pos] === COMMA) {
      pos += 1;
      continue;
    }
    break;
  }

  // The terminator: `\n`, `\r\n`, `\r`, or the end of the document.
  if (pos < end && source[pos] === CR) pos += 1;
  if (pos < end && source[pos] === LF) pos += 1;

  return { cells, next: pos };
}

/**
 * Read a quoted cell whose opening quote sits at `from`.
 *
 * Doubling is resolved here rather than by a regex pass over the finished cell
 * so that a cell with many escapes is assembled from small decodes: the pieces
 * stay independent strings, which is the memory property the module exists for.
 *
 * @param source - The document's bytes.
 * @param from - Offset of the OPENING quote.
 * @returns The unescaped cell value and the offset just past the closing quote.
 */
function readQuotedCell(source: Buffer, from: number): { value: string; next: number } {
  const end = source.length;
  let pos = from + 1;
  let value = '';

  for (;;) {
    const close = source.indexOf(QUOTE, pos);
    if (close < 0) {
      // Unterminated: take the rest of the document and stop.
      value += source.toString('utf8', pos, end);
      return { value, next: end };
    }
    if (close + 1 < end && source[close + 1] === QUOTE) {
      // An escaped quote: keep one, skip both.
      value += source.toString('utf8', pos, close + 1);
      pos = close + 2;
      continue;
    }
    value += source.toString('utf8', pos, close);
    return { value, next: close + 1 };
  }
}

/**
 * The offset of the next unquoted cell separator (comma or line feed).
 *
 * `Buffer.indexOf` is the reason this reader is affordable: it is a native scan,
 * so finding the next separator in a 181 MB file costs one memchr per cell
 * instead of a per-byte interpreter loop.
 *
 * @param source - The document's bytes.
 * @param from - Offset to scan from.
 * @returns The separator's offset, or the document's length when there is none.
 */
function nextSeparator(source: Buffer, from: number): number {
  const comma = source.indexOf(COMMA, from);
  const line = source.indexOf(LF, from);
  if (comma < 0) return line < 0 ? source.length : line;
  if (line < 0) return comma;
  return Math.min(comma, line);
}
