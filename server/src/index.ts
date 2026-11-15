import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import { createApp } from './app';
import { loadConfig } from './config';
import { EventLog } from './persistence/eventLog';
import { Broadcaster } from './realtime/broadcaster';
import { Engine } from './services/engine';

async function main() {
  const config = loadConfig();
  const engine = new Engine(config);
  const app = createApp(engine, config);

  // Serve the built SPA in production (single-process deploy)
  const dist = path.resolve(import.meta.dirname, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const server = createServer(app);
  const io = new Server(server, { cors: { origin: config.corsOrigins }, maxHttpBufferSize: 64_000 });
  const broadcaster = new Broadcaster(io, engine.store, config.jwtSecret, config.broadcastIntervalMs);
  const eventLog = config.dbFile ? await EventLog.open(config.dbFile, engine.store) : null;

  if (config.simulation) engine.start();

  server.listen(config.port, () => {
    console.log(`[uce] API + realtime on http://localhost:${config.port}  (routing: ${config.routingProviders.join(' → ')}, db: ${eventLog ? config.dbFile : 'off'})`);
  });

  const shutdown = () => {
    console.log('[uce] shutting down…');
    engine.stop();
    broadcaster.stop();
    eventLog?.close();
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
