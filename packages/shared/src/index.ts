import { z } from 'zod';

export const sessionStatus = z.enum(['UNKNOWN', 'LOGIN_REQUIRED', 'AUTHENTICATING', 'ACTION_REQUIRED', 'ACTIVE', 'EXPIRED']);
export const browserStatus = z.enum(['STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'CRASHED']);
export const automationStatus = z.enum(['IDLE', 'QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'COMPLETED', 'FAILED', 'CANCELLED']);

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  plan: z.string().default('Chưa xác định'),
  sessionStatus,
  browserStatus,
  automationStatus,
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Account = z.infer<typeof accountSchema>;

export const createAccountSchema = z.object({
  input: z.string().min(1).max(500),
  name: z.string().trim().min(1).max(120).optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const eventSchema = z.object({
  event_id: z.string(), timestamp: z.string(), account_id: z.string().optional(), job_id: z.string().optional(),
  type: z.string(), severity: z.enum(['info', 'warning', 'error']), stage: z.string(),
  duration_ms: z.number().optional(), safe_message: z.string(), error_code: z.string().optional(),
});
export type RouterEvent = z.infer<typeof eventSchema>;
