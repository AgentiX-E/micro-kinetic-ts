/** Storage module — pluggable key-value persistence layer. */
export { defineStoreTests } from './abstract-store-test.js';
export type { IKeyValueStore } from './i-key-value-store.js';
export { KeyNotFoundError, StoreConnectionError, StoreError } from './store-errors.js';
