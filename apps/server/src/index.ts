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
  app.register(cors, { origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] });

  app.addHook('onClose', async () => {
    database.close();
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/browser/open', async (request, reply) => {
    if (!database.getAccount(request.params.id)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản' });
    const job = jobs.enqueue(request.params.id, 'browser.open', async () => {
      const result = await browser.start(request.params.id, { headless: false });
      database.updateRuntimeState(request.params.id, { browserStatus: result.status.state === 'RUNNING' ? 'RUNNING' : 'CRASHED', automationStatus: result.ok ? 'COMPLETED' : 'FAILED' });
      events.publish({ account_id: request.params.id, type: 'BROWSER', severity: result.ok ? 'info' : 'error', stage: 'open', safe_message: result.ok ? 'Chrome profile đã mở.' : 'Không thể mở Chrome profile.', error_code: result.reason });
      if (!result.ok) throw new Error(result.reason ?? 'BROWSER_OPEN_FAILED');
    });
    database.updateRuntimeState(request.params.id, { automationStatus: 'QUEUED' });
    return reply.code(202).send({ jobId: job.id, message: 'Đã xếp hàng mở Chrome profile.' });
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/browser/close', async (request, reply) => {
    if (!database.getAccount(request.params.id)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản' });
    const job = jobs.enqueue(request.params.id, 'browser.close', async () => {
      const result = await browser.stop(request.params.id);
      database.updateRuntimeState(request.params.id, { browserStatus: result.status.state === 'STOPPED' ? 'STOPPED' : 'CRASHED', automationStatus: result.ok ? 'COMPLETED' : 'FAILED' });
      events.publish({ account_id: request.params.id, type: 'BROWSER', severity: result.ok ? 'info' : 'error', stage: 'close', safe_message: result.ok ? 'Chrome profile đã đóng.' : 'Không thể đóng Chrome profile.', error_code: result.reason });
      if (!result.ok) throw new Error(result.reason ?? 'BROWSER_CLOSE_FAILED');
    });
    database.updateRuntimeState(request.params.id, { automationStatus: 'QUEUED' });
    return reply.code(202).send({ jobId: job.id, message: 'Đã xếp hàng đóng Chrome profile.' });
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/check', async (request, reply) => {
    if (!database.getAccount(request.params.id)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản' });
    try {
      const status = await browser.status(request.params.id);
      database.updateRuntimeState(request.params.id, { browserStatus: status.state === 'RUNNING' ? 'RUNNING' : status.state === 'CRASHED' ? 'CRASHED' : 'STOPPED', sessionStatus: 'AUTH_UNKNOWN' });
      events.publish({ account_id: request.params.id, type: 'SESSION', severity: 'warning', stage: 'observe', safe_message: 'Đã kiểm tra local; chưa có bằng chứng xác nhận phiên provider.', error_code: 'AUTH_UNKNOWN' });
      return reply.send({ status, sessionStatus: 'AUTH_UNKNOWN', message: 'Đã kiểm tra trạng thái local; chưa có bằng chứng xác nhận phiên provider.' });
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
    console.error('[flash-router] request failed', { name: error instanceof Error ? error.name : 'UnknownError' });
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
