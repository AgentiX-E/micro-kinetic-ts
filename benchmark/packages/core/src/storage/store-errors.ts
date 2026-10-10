/**
 * Storage error hierarchy.
 *
 * Maps backend failures (filesystem, network, browser storage quota)
 * to typed exceptions that domain code can handle uniformly.
 */

/** Base class for all storage-related errors. */
export class StoreError extends Error {
  constructor(
    message: string,
    public readonly inner?: unknown,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

/** Requested key does not exist in the store. */
export class KeyNotFoundError extends StoreError {
  constructor(key: string) {
    super(`Key not found: ${key}`);
    this.name = 'KeyNotFoundError';
  }
}

/** Storage backend is unreachable (network failure, permission denied, quota exceeded). */
export class StoreConnectionError extends StoreError {
  constructor(message: string, inner?: unknown) {
    super(message, inner);
    this.name = 'StoreConnectionError';
  }
}
