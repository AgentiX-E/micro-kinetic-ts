import { readCsvRecords } from '../../../src/benchmarks/loaders/csv-records.js';

/** Parse a whole document with the same generator the loaders consume, eagerly. */
function parse(text: string | Buffer, maxRecords?: number): string[][] {
  const buffer = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
  const options = maxRecords === undefined ? {} : { maxRecords };
  return [...readCsvRecords(buffer, options)].map((record) => [...record]);
}

describe('readCsvRecords', () => {
  it('yields the header first and then the data records', () => {
    expect(parse('a,b\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('trims surrounding whitespace from unquoted cells, as the header aliases expect', () => {
    expect(parse(' ts , svc \n 1700000000 , svc-a ')).toEqual([
      ['ts', 'svc'],
      ['1700000000', 'svc-a'],
    ]);
  });

  it('yields nothing for an empty document', () => {
    expect(parse('')).toEqual([]);
  });

  it('yields nothing for a document that carries only whitespace and newlines', () => {
    expect(parse('\n\n   \n')).toEqual([]);
  });

  it('treats a header-only document as a single record', () => {
    expect(parse('a,b,c\n')).toEqual([['a', 'b', 'c']]);
  });

  /*
   * The bug this reader exists for. RCAEval's SockShop/OnlineBoutique log
   * messages are JSON documents: `1705595459,front-end,"Posting Address:
   * {""number"":""123"",""city"":""x""}"`. A `split(',')` reader cuts that
   * message at the first comma INSIDE the quotes and hands the rest of the
   * line to columns that do not exist — a silent truncation of exactly the
   * text the log channels rank on.
   */
  it('keeps a comma that sits inside a quoted cell', () => {
    expect(parse('ts,svc,message\n1,front-end,"a,b,c"')).toEqual([
      ['ts', 'svc', 'message'],
      ['1', 'front-end', 'a,b,c'],
    ]);
  });

  it('unescapes doubled quotes inside a quoted cell', () => {
    expect(parse('ts,svc,message\n1,fe,"Posting {""city"":""Paris""}"')).toEqual([
      ['ts', 'svc', 'message'],
      ['1', 'fe', 'Posting {"city":"Paris"}'],
    ]);
  });

  it('keeps an embedded newline inside a quoted cell within one record', () => {
    expect(parse('ts,svc,message\n1,fe,"line one\nline two"\n2,fe,plain')).toEqual([
      ['ts', 'svc', 'message'],
      ['1', 'fe', 'line one\nline two'],
      ['2', 'fe', 'plain'],
    ]);
  });

  it('accepts a quoted cell as the FIRST column without shifting the columns after it', () => {
    expect(parse('a,b\n"1,5",x')).toEqual([
      ['a', 'b'],
      ['1,5', 'x'],
    ]);
  });

  it('preserves the spacing inside a quoted cell instead of trimming it', () => {
    expect(parse('a,b\n1,"  padded  "')).toEqual([
      ['a', 'b'],
      ['1', '  padded  '],
    ]);
  });

  it('reads a quote that appears inside an unquoted cell literally', () => {
    expect(parse('a,b\n5",x')).toEqual([
      ['a', 'b'],
      ['5"', 'x'],
    ]);
  });

  it('handles CRLF line terminators', () => {
    expect(parse('a,b\r\n1,2\r\n3,4\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles a CRLF terminator that follows a quoted cell', () => {
    expect(parse('a,b\r\n1,"x,y"\r\n')).toEqual([
      ['a', 'b'],
      ['1', 'x,y'],
    ]);
  });

  it('strips a UTF-8 BOM from the first header name', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ts,svc\n1,a')]);
    expect(parse(withBom)).toEqual([
      ['ts', 'svc'],
      ['1', 'a'],
    ]);
  });

  it('skips a blank line between records rather than yielding an empty record', () => {
    expect(parse('a,b\n1,2\n\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('yields a ragged record as-is, leaving padding to the caller', () => {
    expect(parse('a,b,c\n1,2')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2'],
    ]);
  });

  it('yields an empty trailing cell rather than dropping it', () => {
    expect(parse('a,b,c\n1,2,')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('decodes multibyte UTF-8 per cell', () => {
    expect(parse('svc,message\ncártes,服务不可用')).toEqual([
      ['svc', 'message'],
      ['cártes', '服务不可用'],
    ]);
  });

  it('consumes an unterminated quoted cell to the end of the document without throwing', () => {
    expect(parse('a,b\n1,"unterminated')).toEqual([
      ['a', 'b'],
      ['1', 'unterminated'],
    ]);
  });

  it('caps the number of DATA records while always yielding the header', () => {
    expect(parse('a,b\n1,2\n3,4\n5,6', 2)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('yields only the header when the cap is zero', () => {
    expect(parse('a,b\n1,2', 0)).toEqual([['a', 'b']]);
  });

  it('stops scanning once the cap is reached, so a huge file costs only its prefix', () => {
    // 200k records behind the cap: the reader must not walk them. The check is
    // on the yielded count, which is the only observable the caller relies on.
    const rows = ['a,b'];
    for (let i = 0; i < 200_000; i++) rows.push(`${i},x`);
    expect(parse(rows.join('\n'), 3)).toHaveLength(4);
  });
});
