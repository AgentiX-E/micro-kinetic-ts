import { describe, expect, it } from 'vitest';
import {
  KeyNotFoundError,
  StoreConnectionError,
  StoreError,
} from '../../../src/storage/store-errors.js';

describe('StoreError', () => {
  it('should have correct name', () => {
    const err = new StoreError('test');
    expect(err.name).toBe('StoreError');
    expect(err.message).toBe('test');
  });

  it('should be instanceof Error', () => {
    const err = new StoreError('test');
    expect(err).toBeInstanceOf(Error);
  });

  it('should store inner cause', () => {
    const original = new Error('root');
    const err = new StoreError('wrapper', original);
    expect(err.inner).toBe(original);
  });
});

describe('KeyNotFoundError', () => {
  it('should include key in message', () => {
    const err = new KeyNotFoundError('my-key');
    expect(err.message).toContain('my-key');
    expect(err.name).toBe('KeyNotFoundError');
  });

  it('should be instanceof StoreError', () => {
    const err = new KeyNotFoundError('k');
    expect(err).toBeInstanceOf(StoreError);
  });
});

describe('StoreConnectionError', () => {
  it('should have correct name', () => {
    const err = new StoreConnectionError('conn failed');
    expect(err.name).toBe('StoreConnectionError');
    expect(err.message).toBe('conn failed');
  });

  it('should be instanceof StoreError', () => {
    const err = new StoreConnectionError('x');
    expect(err).toBeInstanceOf(StoreError);
  });
});
