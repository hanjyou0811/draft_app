import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestError, toPublicError } from './errors.js';
import { DraftService, ServiceError, type PickRequest } from './service.js';
const MAX_JSON_BODY_BYTES = 256 * 1024;

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError(400, 'リクエストの形式が正しくありません。');
  }
  return value as Record<string, unknown>;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parsed = (request as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    const serialized = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    if (Buffer.byteLength(serialized) > MAX_JSON_BODY_BYTES) {
      throw new RequestError(413, 'リクエストが大きすぎます。');
    }
    try { return requireRecord(typeof parsed === 'string' ? JSON.parse(parsed) : parsed); }
    catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(400, 'リクエストの形式が正しくありません。');
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new RequestError(413, 'リクエストが大きすぎます。');
    }
    chunks.push(buffer);
  }
  try {
    return requireRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'リクエストの形式が正しくありません。');
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') {
    throw new RequestError(400, 'リクエストの形式が正しくありません。');
  }
  return value;
}

function requireNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number') {
    throw new RequestError(400, 'リクエストの形式が正しくありません。');
  }
  return value;
}

function bearerToken(request: IncomingMessage): string {
  const match = /^Bearer ([^\s]+)$/u.exec(request.headers.authorization ?? '');
  if (match?.[1] === undefined) throw new ServiceError('UNAUTHORIZED');
  return match[1];
}

function roomIdFrom(match: RegExpExecArray): string {
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    throw new RequestError(400, '会議IDが正しくありません。');
  }
}

export async function routeApi(
  request: IncomingMessage,
  response: ServerResponse,
  service: DraftService,
  pathname: string,
): Promise<boolean> {
  if (request.method === 'POST' && pathname === '/api/rooms') {
    const body = await readJson(request);
    const credentials = await service.createRoom({
      name: requireString(body, 'name'),
      names: requireString(body, 'names'),
      teamSize: requireNumber(body, 'teamSize'),
    });
    sendJson(response, 201, credentials);
    return true;
  }

  const infoMatch = /^\/api\/rooms\/([^/]+)\/info$/u.exec(pathname);
  if (request.method === 'GET' && infoMatch !== null) {
    sendJson(response, 200, await service.getInfo(roomIdFrom(infoMatch)));
    return true;
  }

  const joinMatch = /^\/api\/rooms\/([^/]+)\/join$/u.exec(pathname);
  if (request.method === 'POST' && joinMatch !== null) {
    const body = await readJson(request);
    const roomId = roomIdFrom(joinMatch);
    sendJson(response, 201, await service.joinRoom(roomId, {
      name: requireString(body, 'name'),
    }));
    return true;
  }

  const startMatch = /^\/api\/rooms\/([^/]+)\/start$/u.exec(pathname);
  if (request.method === 'POST' && startMatch !== null) {
    const roomId = roomIdFrom(startMatch);
    sendJson(response, 200, await service.startRoom({ roomId, token: bearerToken(request) }));
    return true;
  }

  const pickMatch = /^\/api\/rooms\/([^/]+)\/picks$/u.exec(pathname);
  if (request.method === 'POST' && pickMatch !== null) {
    const body = await readJson(request);
    const roomId = roomIdFrom(pickMatch);
    const input: PickRequest = {
      candidateId: requireString(body, 'candidateId'),
      round: requireNumber(body, 'round'),
      attempt: requireNumber(body, 'attempt'),
    };
    sendJson(response, 200, await service.submitPick({ roomId, token: bearerToken(request) }, input));
    return true;
  }

  const roomMatch = /^\/api\/rooms\/([^/]+)$/u.exec(pathname);
  if (request.method === 'GET' && roomMatch !== null) {
    const roomId = roomIdFrom(roomMatch);
    sendJson(response, 200, await service.getRoom({ roomId, token: bearerToken(request) }));
    return true;
  }

  return false;
}

export function sendError(response: ServerResponse, error: unknown): void {
  const mapped = toPublicError(error);
  if (mapped !== undefined) {
    sendJson(response, mapped.status, { error: mapped.message });
    return;
  }
  console.error('Unhandled request error', error);
  sendJson(response, 500, { error: 'サーバーでエラーが発生しました。' });
}

