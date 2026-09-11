import type { IncomingMessage, ServerResponse } from 'node:http';
import { routeApi, sendError, sendJson } from '../server/api.js';
import { DraftService } from '../server/service.js';
import { SupabaseRoomRepository } from '../server/supabase.js';

let service: DraftService | undefined;
export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    service ??= new DraftService(new SupabaseRoomRepository(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SECRET_KEY ?? '',
    ));
    const url = new URL(request.url ?? '/', 'http://localhost');
    const route = url.searchParams.get('route');
    const pathname = route === null ? url.pathname : `/api/${route}`;
    if (!await routeApi(request, response, service, pathname)) {
      sendJson(response, 404, { error: 'APIが見つかりません。' });
    }
  } catch (error) { sendError(response, error); }
}
