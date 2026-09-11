import { pathToFileURL } from 'node:url';

import { createDraftServer, type DraftServer } from './http.js';

export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly databasePath: string;
}

export function readServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const portText = environment.PORT ?? '3001';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
  return {
    port,
    host: environment.HOST ?? '0.0.0.0',
    databasePath: environment.DATABASE_PATH ?? 'data/draft-room.sqlite',
  };
}

export async function startServer(environment: NodeJS.ProcessEnv = process.env): Promise<DraftServer> {
  const config = readServerConfig(environment);
  const server = createDraftServer({ databasePath: config.databasePath });
  const address = await server.listen(config.port, config.host);
  console.log(`Draft room server listening on ${address.origin}`);
  return server;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  startServer().then((server) => {
    const shutdown = () => {
      void server.close().then(() => process.exit(0), (error: unknown) => {
        console.error(error);
        process.exit(1);
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
