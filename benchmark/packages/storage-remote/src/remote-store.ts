/**
 * RemoteStore — IKeyValueStore backed by HTTP REST API.
 *
 * Designed for S3/COS-compatible object storage via REST endpoints.
 * Uses exponential backoff retry (3 attempts) on 5xx and network errors.
 * Auth is injected via headers at construction time — never hardcoded.
 *
 * @packageDocumentation
 */

import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';
import { StoreConnectionError } from '@agentix-e/micro-kinetic-core';

// ── Options ──

export interface RemoteStoreOptions {
  readonly baseUrl: string;
  readonly headers?: Record<string, string>;
  readonly timeout?: number;
  readonly retries?: number;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRIES = 3;

// ── Implementation ──

export class RemoteStore implements IKeyValueStore {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly retries: number;

  constructor(options: RemoteStoreOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.headers = options.headers ?? {};
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  private url(key: string): string {
    return `${this.baseUrl}/${encodeURIComponent(key)}`;
  }

  private async request(method: string, url: string, body?: string | null): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const init: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...this.headers,
          },
          signal: controller.signal,
        };
        if (body !== undefined) init.body = body;

        const response = await fetch(url, init);
        clearTimeout(timer);

        if (response.status >= 500) {
          lastError = new StoreConnectionError(`Server error ${response.status}`);
          if (attempt < this.retries) continue;
          throw lastError;
        }

        return response;
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === 'StoreConnectionError') {
          throw err;
        }
        lastError = err;
        if (attempt < this.retries) continue;
      }
    }

    throw new StoreConnectionError(`Request failed after ${this.retries + 1} attempts`, lastError);
  }

  async get<T>(key: string): Promise<T | null> {
    const response = await this.request('GET', this.url(key));
    if (response.status === 404) return null;
    return (await response.json()) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.request('PUT', this.url(key), JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', this.url(key));
    if (response.status !== 404 && !response.ok) {
      throw new StoreConnectionError(`Failed to delete: ${response.status}`);
    }
  }

  async has(key: string): Promise<boolean> {
    const response = await this.request('HEAD', this.url(key));
    return response.status !== 404 && response.ok;
  }

  async keys(prefix?: string): Promise<string[]> {
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const response = await this.request('GET', `${this.baseUrl}/${query}`);
    return (await response.json()) as string[];
  }

  async clear(): Promise<void> {
    const response = await this.request('DELETE', this.baseUrl);
    if (response.status !== 404 && !response.ok) {
      throw new StoreConnectionError(`Failed to clear: ${response.status}`);
    }
  }

  async close(): Promise<void> {
    // HTTP is stateless
  }
}
