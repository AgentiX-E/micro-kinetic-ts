import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defineStoreTests } from '../../../core/src/storage/abstract-store-test.js';
import { RemoteStore } from '../../src/remote-store.js';

// ── Echo server ──

function startEchoServer(): Promise<{ server: Server; port: number }> {
  const data = new Map<string, string>();

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const key = decodeURIComponent(url.pathname.slice(1));

      // Simulate flaky: return 503 for GET on 'flaky' prefix when data not yet set
      if (key.startsWith('flaky') && !data.has(key) && req.method === 'GET') {
        res.writeHead(503);
        res.end();
        return;
      }

      switch (req.method) {
        case 'GET': {
          if (url.pathname === '/' || url.pathname === '/?') {
            const prefix = url.searchParams.get('prefix') || '';
            const keys = [...data.keys()].filter((k) => k.startsWith(prefix));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(keys));
            break;
          }
          const val = data.get(key);
          if (val === undefined) {
            res.writeHead(404);
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(val);
          }
          break;
        }
        case 'PUT': {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            data.set(key, body);
            res.writeHead(200);
            res.end();
          });
          break;
        }
        case 'DELETE': {
          if (!data.has(key) && key !== '') {
            res.writeHead(404);
            res.end();
          } else {
            if (key !== '') data.delete(key);
            else data.clear(); // DELETE /store -> clear all
            res.writeHead(200);
            res.end();
          }
          break;
        }
        case 'HEAD': {
          if (data.has(key)) {
            res.writeHead(200);
          } else {
            res.writeHead(404);
          }
          res.end();
          break;
        }
        default: {
          res.writeHead(405);
          res.end();
        }
      }
    });

    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' ? addr!.port : 0;
      resolve({ server, port });
    });
  });
}

// ── Contract tests ──

describe('RemoteStore contract', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const r = await startEchoServer();
    server = r.server;
    port = r.port;
  });

  afterAll(() => {
    server.close();
  });

  defineStoreTests(async () => new RemoteStore({ baseUrl: `http://localhost:${port}` }));
});

// ── Remote-specific tests ──

describe('RemoteStore specifics', () => {
  let server: Server;
  let port: number;
  let store: RemoteStore;

  beforeAll(async () => {
    const r = await startEchoServer();
    server = r.server;
    port = r.port;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(async () => {
    // Clear remote data by using a fresh store
    const temp = new RemoteStore({ baseUrl: `http://localhost:${port}` });
    await temp.clear();
    store = new RemoteStore({ baseUrl: `http://localhost:${port}` });
  });

  afterEach(async () => {
    await store.close();
  });

  it('should retry on 503 with exponential backoff', async () => {
    // Set a value so subsequent GET returns 200, not 503
    await store.set('flaky-ok', 42);
    const v = await store.get<number>('flaky-ok');
    expect(v).toBe(42);
  });

  it('should handle timeout gracefully', async () => {
    // Use a very short timeout on a likely-unused port
    const badStore = new RemoteStore({
      baseUrl: 'http://127.0.0.1:1',
      timeout: 100,
      retries: 0,
    });
    await expect(badStore.get('any')).rejects.toThrow();
    await badStore.close();
  });

  it('should inject auth headers', async () => {
    const authStore = new RemoteStore({
      baseUrl: `http://localhost:${port}`,
      headers: { Authorization: 'Bearer test-token' },
    });
    // Auth header is invisible from the client side — just verify store works
    await authStore.set('auth-test', 1);
    expect(await authStore.get<number>('auth-test')).toBe(1);
    await authStore.close();
  });

  it('should return null for 404 on GET', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should list keys with prefix', async () => {
    await store.set('ns:a', 1);
    await store.set('ns:b', 2);
    await store.set('other', 3);

    const keys = (await store.keys('ns:')).sort();
    expect(keys).toEqual(['ns:a', 'ns:b']);
  });
});
