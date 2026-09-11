import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';

import { toPublicError } from './errors.js';
import { DraftService, ServiceError, type RoomSubscription } from './service.js';

export interface WebSocketOptions {
  readonly authenticationTimeoutMs: number;
  readonly heartbeatIntervalMs: number;
  readonly allowedOrigins: readonly string[];
}

export interface WebSocketController {
  close(): Promise<void>;
}

function acceptsOrigin(request: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return allowedOrigins.has(parsed.origin) || parsed.host === request.headers.host;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket: Duplex, status: 403 | 404): void {
  const reason = status === 403 ? 'Forbidden' : 'Not Found';
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function credentialsFrom(data: WebSocket.RawData, isBinary: boolean): {
  roomId: string;
  token: string;
} {
  if (isBinary) throw new ServiceError('UNAUTHORIZED');
  let value: unknown;
  try {
    value = JSON.parse(data.toString()) as unknown;
  } catch {
    throw new ServiceError('UNAUTHORIZED');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ServiceError('UNAUTHORIZED');
  }
  const { roomId, token } = value as Record<string, unknown>;
  if (typeof roomId !== 'string' || typeof token !== 'string') {
    throw new ServiceError('UNAUTHORIZED');
  }
  return { roomId, token };
}

export function attachWebSocketServer(
  httpServer: HttpServer,
  service: DraftService,
  options: WebSocketOptions,
): WebSocketController {
  const allowedOrigins = new Set(options.allowedOrigins.map((origin) => new URL(origin).origin));
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
  });
  const alive = new WeakMap<WebSocket, boolean>();

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      rejectUpgrade(socket, 404);
      return;
    }
    if (pathname !== '/ws') {
      rejectUpgrade(socket, 404);
      return;
    }
    if (!acceptsOrigin(request, allowedOrigins)) {
      rejectUpgrade(socket, 403);
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (socket) => {
    let subscription: RoomSubscription | undefined;
    let authenticationStarted = false;
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));

    const authenticationTimer = setTimeout(() => {
      socket.close(1008, '認証が必要です。');
    }, options.authenticationTimeoutMs);
    authenticationTimer.unref();
    socket.on('error', () => {
      clearTimeout(authenticationTimer);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1011, '接続エラーが発生しました。');
      }
    });

    socket.on('message', (data, isBinary) => {
      if (authenticationStarted) {
        if (subscription !== undefined) socket.close(1008, '操作はHTTP APIを使用してください。');
        return;
      }
      authenticationStarted = true;
      void Promise.resolve().then(() => service.subscribe(
        credentialsFrom(data, isBinary),
        (room) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'snapshot', room }));
          }
        },
      )).then((connected) => {
        clearTimeout(authenticationTimer);
        if (socket.readyState === WebSocket.OPEN) subscription = connected;
        else connected.unsubscribe();
      }).catch((error: unknown) => {
        clearTimeout(authenticationTimer);
        const mapped = toPublicError(error) ?? {
          status: 500,
          message: 'サーバーでエラーが発生しました。',
        };
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'error', error: mapped.message }), () => {
            socket.close(1008, mapped.message);
          });
        }
      });
    });

    socket.once('close', () => {
      clearTimeout(authenticationTimer);
      subscription?.unsubscribe();
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of webSocketServer.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, options.heartbeatIntervalMs);
  heartbeat.unref();

  return {
    close: async () => {
      clearInterval(heartbeat);
      for (const socket of webSocketServer.clients) socket.terminate();
      await new Promise<void>((resolveClose) => webSocketServer.close(() => resolveClose()));
    },
  };
}
