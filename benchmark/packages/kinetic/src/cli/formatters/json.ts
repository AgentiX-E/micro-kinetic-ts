/**
 * JSON output formatter for CLI results.
 *
 * @module cli/formatters/json
 */

/**
 * Format data as pretty-printed JSON.
 */
export function formatJson(data: unknown, pretty = true): string {
  try {
    return JSON.stringify(data, jsonReplacer, pretty ? 2 : 0);
  } catch {
    return JSON.stringify({ error: 'Failed to serialize result' });
  }
}

/**
 * Custom JSON replacer to handle BigInt, Map, Set, and Float64Array.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  if (value instanceof Set) {
    return Array.from(value);
  }
  if (value instanceof Float64Array) {
    return Array.from(value);
  }
  return value;
}
