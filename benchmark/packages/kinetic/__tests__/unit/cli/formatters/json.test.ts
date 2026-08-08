import { describe, it, expect } from 'vitest';
import { formatJson } from '../../../../src/cli/formatters/json.js';

describe('formatJson', () => {
  it('should format primitive values as JSON', () => {
    expect(formatJson(42)).toBe('42');
    expect(formatJson('hello')).toBe('"hello"');
    expect(formatJson(true)).toBe('true');
    expect(formatJson(null)).toBe('null');
  });

  it('should format object as pretty JSON by default', () => {
    const output = formatJson({ name: 'test', value: 42 });
    expect(output).toContain('"name"');
    expect(output).toContain('"test"');
    expect(output).toContain('"value"');
    expect(output).toContain('42');
  });

  it('should format object as compact JSON when pretty=false', () => {
    const output = formatJson({ name: 'test', value: 42 }, false);
    expect(output).not.toContain('\n');
    expect(output).toContain('"name":"test"');
  });

  it('should handle arrays', () => {
    const output = formatJson([1, 2, 3]);
    expect(output).toContain('1');
    expect(output).toContain('2');
    expect(output).toContain('3');
  });

  it('should handle Map', () => {
    const map = new Map([['key1', 'val1'], ['key2', 'val2']]);
    const output = formatJson(map);
    expect(output).toContain('key1');
    expect(output).toContain('val1');
  });

  it('should handle Set', () => {
    const set = new Set(['a', 'b', 'c']);
    const output = formatJson(set);
    expect(output).toContain('a');
    expect(output).toContain('b');
    expect(output).toContain('c');
  });

  it('should handle Float64Array', () => {
    const f64 = new Float64Array([1.1, 2.2, 3.3]);
    const output = formatJson(f64);
    expect(output).toContain('1.1');
    expect(output).toContain('2.2');
  });

  it('should handle BigInt', () => {
    const output = formatJson(BigInt(9007199254740991));
    expect(output).toContain('9007199254740991');
  });

  it('should handle circular references gracefully', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const output = formatJson(obj);
    expect(typeof output).toBe('string');
  });
});
