import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeApi, sendJson, sendError } from './api.js';
import { SqliteRoomRepository } from './sqlite.js';
import {
  DraftService,
  type DraftServiceOptions,
} from './service.js';
import { attachWebSocketServer } from './websocket.js';

const DEFAULT_STATIC_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

export interface DraftServerOptions extends DraftServiceOptions {
  readonly databasePath?: string;
  readonly staticDirectory?: string;
  readonly authenticationTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly allowedOrigins?: readonly string[];
}

export interface ListeningAddress {
  readonly host: string;
  readonly port: number;
  readonly origin: string;
}

export interface DraftServer {
  readonly service: DraftService;
  listen(port?: number, host?: string): Promise<ListeningAddress>;
  close(): Promise<void>;
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  staticDirectory: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 404, { error: 'ページが見つかりません。' });
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: 'URLが正しくありません。' });
    return;
  }
  const requested = resolve(staticDirectory, `.${decoded === '/' ? '/index.html' : decoded}`);
  const safe = requested === staticDirectory || requested.startsWith(`${staticDirectory}${sep}`);
  if (safe) {
    try {
      const metadata = await stat(requested);
      if (metadata.isFile()) {
        response.writeHead(200, {
          'content-type': contentTypes[extname(requested)] ?? 'application/octet-stream',
          'content-length': metadata.size,
        });
        if (request.method === 'HEAD') response.end();
        else createReadStream(requested).pipe(response);
        return;
      }
    } catch {
      // UI routes fall through to index.html below.
    }
  }

  const acceptsHtml = (request.headers.accept ?? '').includes('text/html');
  if (!acceptsHtml) {
    sendJson(response, 404, { error: 'ページが見つかりません。' });
    return;
  }
  try {
    const index = await readFile(resolve(staticDirectory, 'index.html'));
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': index.length,
    });
    response.end(request.method === 'HEAD' ? undefined : index);
  } catch {
    sendJson(response, 404, { error: 'ページが見つかりません。' });
  }
}

export function createDraftServer(options: DraftServerOptions = {}): DraftServer {
  const repository = new SqliteRoomRepository(options.databasePath ?? 'data/draft-room.sqlite');
  const service = new DraftService(repository, {
    ...(options.createId === undefined ? {} : { createId: options.createId }),
    ...(options.createToken === undefined ? {} : { createToken: options.createToken }),
    ...(options.chooseIndex === undefined ? {} : { chooseIndex: options.chooseIndex }),
  });
  const staticDirectory = resolve(options.staticDirectory ?? DEFAULT_STATIC_DIRECTORY);
  let listening = false;
  let closed = false;

  const httpServer = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (!await routeApi(request, response, service, url.pathname)) {
          sendJson(response, 404, { error: 'APIが見つかりません。' });
        }
        return;
      }
      await serveStatic(request, response, url.pathname, staticDirectory);
    })().catch((error: unknown) => sendError(response, error));
  });
  httpServer.requestTimeout = 15_000;
  httpServer.headersTimeout = 10_000;

  const webSockets = attachWebSocketServer(httpServer, service, {
    authenticationTimeoutMs: options.authenticationTimeoutMs ?? 5_000,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30_000,
    allowedOrigins: options.allowedOrigins ?? [],
  });

  return {
    service,
    listen: async (port = 0, host = '127.0.0.1') => {
      if (closed) throw new Error('server is closed');
      await new Promise<void>((resolveListen, reject) => {
        const onError = (error: Error) => reject(error);
        httpServer.once('error', onError);
        httpServer.listen(port, host, () => {
          httpServer.off('error', onError);
          listening = true;
          resolveListen();
        });
      });
      const address = httpServer.address() as AddressInfo;
      const displayHost = address.address.includes(':') ? `[${address.address}]` : address.address;
      return { host: address.address, port: address.port, origin: `http://${displayHost}:${address.port}` };
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await webSockets.close();
      if (listening) {
        await new Promise<void>((resolveClose, reject) => {
          httpServer.close((error) => error ? reject(error) : resolveClose());
        });
      }
      repository.close();
    },
  };
}
