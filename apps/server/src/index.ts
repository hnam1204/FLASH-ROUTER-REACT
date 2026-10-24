import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerAccountRoutes } from './accounts/index.js';
import { AccountDatabase } from './database/index.js';
import { BrowserSupervisor } from './browser/index.js';
import { DeletionCoordinator } from './deletion/index.js';
import { EventHub } from './events/index.js';
import { JobManager } from './jobs/index.js';

export type AppOptions = {
  databasePath?: string;
  dataDir?: string;
  profilesRoot?: string;
};

function defaultDataDirectory(): string {
  return process.env.FLASH_ROUTER_DATA_DIR
    ?? (process.env.LOCALAPPDATA
      ? resolve(process.env.LOCALAPPDATA, 'FLASH ROUTER')
      : resolve(process.cwd(), '.flash-router-data'));
}

function defaultDatabasePath(): string {
  return resolve(defaultDataDirectory(), 'router.sqlite');
}

function readPort(): number {
  const value = Number(process.env.FLASH_ROUTER_PORT ?? '3001');
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('invalid port');
  }
  return value;
}

export function buildApp(options: AppOptions = {}) {
  const database = new AccountDatabase(options.databasePath ?? defaultDatabasePath());
  const dataDir = options.dataDir ?? defaultDataDirectory();
  const profilesRoot = options.profilesRoot ?? resolve(dataDir, 'profiles');
  const browser = new BrowserSupervisor({ profilesRoot });
  const deletion = new DeletionCoordinator(browser, { dataDir });
  const events = new EventHub();
  const jobs = new JobManager(events);
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  app.addHook('onClose', async () => {
    database.close();
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/browser/open', async (request, reply) => {
    if (!database.getAccount(request.params.id)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản' });
    const result = await browser.start(request.params.id, { headless: false });
    events.publish({ account_id: request.params.id, type: 'BROWSER', severity: result.ok ? 'info' : 'error', stage: 'open', safe_message: result.ok ? 'Chrome profile đã mở.' : 'Không thể mở Chrome profile.', error_code: result.reason });
    return reply.code(result.ok ? 200 : 409).send(result);
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/browser/close', async (request, reply) => {
    if (!database.getAccount(request.params.id)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản' });
    const result = await browser.stop(request.params.id);
    events.publish({ account_id: request.params.id, type: 'BROWSER', severity: result.ok ? 'info' : 'error', stage: 'close', safe_message: result.ok ? 'Chrome profile đã đóng.' : 'Không thể đóng Chrome profile.', error_code: result.reason });
    return reply.code(result.ok ? 200 : 409).send(result);
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/check', async (request, reply) => {
    if (!database.getAccount(request.params.id)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản' });
    try {
      const status = await browser.status(request.params.id);
      events.publish({ account_id: request.params.id, type: 'SESSION', severity: 'info', stage: 'observe', safe_message: 'Đã kiểm tra trạng thái local; session provider chưa được xác nhận.' });
      return reply.send({ status, message: 'Đã kiểm tra trạng thái local; session provider chưa được xác nhận.' });
    } catch {
      return reply.code(503).send({ error: 'BROWSER_STATUS_UNAVAILABLE', message: 'Chưa thể kiểm tra runtime Chrome trên máy này.' });
    }
  });

  app.get('/api/events/stream', async (_request, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for (const event of events.recent()) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = events.subscribe((event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`));
    reply.raw.write(`data: ${JSON.stringify(events.publish({ type: 'SYSTEM', severity: 'info', stage: 'ready', safe_message: 'Đã kết nối console an toàn.' }))}\n\n`);
    reply.raw.on('close', () => { unsubscribe(); reply.raw.end(); });
    return reply;
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const job = jobs.get(request.params.id);
    return job ? reply.send(job) : reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy job' });
  });

  app.get('/api/health/live', async () => ({
    status: 'ok',
    service: 'flash-router',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/health/ready', async (_request, reply) => {
    if (!database.isReady()) {
      return reply.code(503).send({
        status: 'not_ready',
        service: 'flash-router',
      });
    }
    return reply.send({
      status: 'ready',
      service: 'flash-router',
    });
  });

  registerAccountRoutes(app, database, deletion);
  app.setErrorHandler(async (error, _request, reply) => {
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[flash-router] ${errorMessage}`);
    return reply.code(500).send({
    error: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi máy chủ',
    });
  });
  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  try {
    await app.listen({
      host: process.env.FLASH_ROUTER_HOST ?? '127.0.0.1',
      port: readPort(),
    });
  } catch {
    await app.close();
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void start();
}
