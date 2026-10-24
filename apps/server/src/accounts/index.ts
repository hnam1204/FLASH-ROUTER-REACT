import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { accountSchema, createAccountSchema } from '@flash-router/shared';
import { AccountDatabase, DuplicateEmailError, type AccountCursor } from '../database/index.js';
import type { DeletionCoordinator } from '../deletion/index.js';
import { z } from 'zod';

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  plan: z.string().trim().min(1).max(120).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Cần cung cấp metadata cần cập nhật');

const deleteAccountSchema = z.object({ confirm: z.literal(true), expectedEmail: z.string().email().optional() });

type AccountParams = { id: string };
type AccountListQuery = { cursor?: string; limit?: string; q?: string };
type AccountRouteOptions = {
  beforeDelete?: (id: string) => void;
  afterDelete?: (id: string) => void;
};

function validationError(reply: FastifyReply, details: string[] = ['Dữ liệu không hợp lệ']) {
  return reply.code(400).send({
    error: 'VALIDATION_ERROR',
    message: 'Dữ liệu không hợp lệ',
    details,
  });
}

function decodeCursor(value: string | undefined): AccountCursor | null | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<AccountCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || !parsed.id) {
      return null;
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function parseCredentialInput(input: string): { email: string } | null {
  const email = input.trim().toLowerCase();
  return z.string().email().safeParse(email).success ? { email } : null;
}

export function registerAccountRoutes(app: FastifyInstance, database: AccountDatabase, deletion?: DeletionCoordinator, options: AccountRouteOptions = {}): void {
  app.get<{ Querystring: AccountListQuery }>('/api/accounts', async (request, reply) => {
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    const query = request.query.q?.trim() ?? '';
    const cursor = decodeCursor(request.query.cursor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return validationError(reply, ['limit phải là số nguyên từ 1 đến 1000']);
    }
    if (query.length > 120) {
      return validationError(reply, ['q không được dài quá 120 ký tự']);
    }
    if (cursor === null) {
      return validationError(reply, ['cursor không hợp lệ']);
    }
    const page = database.listAccounts(query, limit, cursor);
    return reply.send({ accounts: page.items, nextCursor: page.nextCursor });
  });

  app.get<{ Params: AccountParams }>('/api/accounts/:id', async (request, reply) => {
    const account = database.getAccount(request.params.id);
    return account ? reply.send(account) : reply.code(404).send({
      error: 'NOT_FOUND',
      message: 'Không tìm thấy tài khoản',
    });
  });

  app.post('/api/accounts', async (request, reply) => {
    const parsedBody = createAccountSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return validationError(reply, parsedBody.error.issues.map((issue) => issue.message));
    }
    const parsedCredentials = parseCredentialInput(parsedBody.data.input);
    if (!parsedCredentials) {
      return validationError(reply, ['input phải là email hợp lệ']);
    }
    const account = accountSchema.parse({
      id: randomUUID(),
      name: parsedBody.data.name ?? parsedCredentials.email,
      email: parsedCredentials.email,
      plan: 'Chưa xác định',
      sessionStatus: 'UNKNOWN',
      browserStatus: 'STOPPED',
      automationStatus: 'IDLE',
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
    });
    try {
      return reply.code(201).send(database.createAccount(account));
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        return reply.code(409).send({
          error: 'DUPLICATE_EMAIL',
          message: 'Email đã tồn tại',
        });
      }
      throw error;
    }
  });

  app.patch<{ Params: AccountParams }>('/api/accounts/:id', async (request, reply) => {
    const parsedBody = updateAccountSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return validationError(reply, parsedBody.error.issues.map((issue) => issue.message));
    }
    const account = database.updateAccount(request.params.id, parsedBody.data);
    return account ? reply.send(account) : reply.code(404).send({
      error: 'NOT_FOUND',
      message: 'Không tìm thấy tài khoản',
    });
  });

  app.delete<{ Params: AccountParams }>('/api/accounts/:id', async (request, reply) => {
    const parsedBody = deleteAccountSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return validationError(reply, ['Xác nhận xóa bằng {"confirm":true}']);
    }
    if (!database.getAccount(request.params.id)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản' });
    }
    const currentAccount = database.getAccount(request.params.id);
    if (parsedBody.data.expectedEmail && parsedBody.data.expectedEmail.toLowerCase() !== currentAccount?.email.toLowerCase()) {
      return reply.code(409).send({ error: 'IDENTITY_MISMATCH', message: 'Email xác nhận không khớp hồ sơ.' });
    }
    options.beforeDelete?.(request.params.id);
    if (deletion) {
      const result = await deletion.deleteAccount(request.params.id);
      if (!result.ok) {
        options.afterDelete?.(request.params.id);
        return reply.code(409).send({ error: result.code, message: result.message });
      }
    }
    if (!database.deleteAccount(request.params.id)) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'Không tìm thấy tài khoản',
      });
    }
    options.afterDelete?.(request.params.id);
    return reply.send({ deleted: true, id: request.params.id });
  });
}
