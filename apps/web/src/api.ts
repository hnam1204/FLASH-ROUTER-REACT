export type SessionStatus =
  | 'UNKNOWN'
  | 'AUTH_UNKNOWN'
  | 'LOGIN_REQUIRED'
  | 'AUTHENTICATING'
  | 'ACTION_REQUIRED'
  | 'ACTIVE'
  | 'EXPIRED';

export type BrowserStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'CRASHED';

export interface Account {
  id: string;
  name: string;
  email: string;
  plan: string;
  sessionStatus: SessionStatus;
  browserStatus: BrowserStatus;
  automationStatus: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RouterEvent {
  event_id: string;
  timestamp: string;
  account_id?: string;
  job_id?: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  stage: string;
  duration_ms?: number;
  safe_message: string;
  error_code?: string;
}

export interface AccountPage {
  accounts: Account[];
  nextCursor: string | null;
  total?: number;
}

export interface MutationResult {
  account?: Account;
  jobId?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
  ) {
    super('API request failed');
    this.name = 'ApiError';
  }
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeAccount(value: unknown): Account | null {
  if (!isRecord(value)) return null;

  const id = readString(value.id);
  const email = readString(value.email);
  if (!id || !email) return null;

  return {
    id,
    email,
    name: readString(value.name, 'Chưa xác định'),
    plan: readString(value.plan, 'Chưa xác định'),
    sessionStatus: readString(value.sessionStatus, 'UNKNOWN') as SessionStatus,
    browserStatus: readString(value.browserStatus, 'STOPPED') as BrowserStatus,
    automationStatus: readString(value.automationStatus, 'IDLE'),
    lastLoginAt: typeof value.lastLoginAt === 'string' ? value.lastLoginAt : null,
    createdAt: readString(value.createdAt),
  };
}

function extractJobId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.jobId === 'string') return payload.jobId;
  if (typeof payload.job_id === 'string') return payload.job_id;
  if (isRecord(payload.job) && typeof payload.job.id === 'string') return payload.job.id;
  return undefined;
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR');
  }

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : undefined;
    throw new ApiError(response.status, code);
  }

  return payload as T;
}

export async function listAccounts(
  query: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<AccountPage> {
  const params = new URLSearchParams({ limit: '100' });
  if (query.trim()) params.set('q', query.trim());
  if (cursor) params.set('cursor', cursor);

  const payload = await request<unknown>(`/api/accounts?${params.toString()}`, {}, signal);
  const collection = isRecord(payload) ? payload : {};
  const rawAccounts = Array.isArray(payload) ? payload : collection.accounts;
  if (!Array.isArray(rawAccounts)) throw new ApiError(502, 'INVALID_RESPONSE');

  const accounts = rawAccounts.map(normalizeAccount).filter((account): account is Account => account !== null);
  if (accounts.length !== rawAccounts.length) throw new ApiError(502, 'INVALID_RESPONSE');

  return {
    accounts,
    nextCursor: isRecord(payload) && typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
    total: isRecord(payload) && typeof payload.total === 'number' ? payload.total : undefined,
  };
}

export async function createAccount(input: string, name: string): Promise<MutationResult> {
  const payload = await request<unknown>('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ input, ...(name.trim() ? { name: name.trim() } : {}) }),
  });
  const account = isRecord(payload) ? normalizeAccount(payload.account ?? payload) : null;
  return { account: account ?? undefined, jobId: extractJobId(payload) };
}

export async function accountAction(
  accountId: string,
  action: 'open' | 'close' | 'check',
): Promise<MutationResult> {
  const route = action === 'check' ? `/api/accounts/${accountId}/check` : `/api/accounts/${accountId}/browser/${action}`;
  const payload = await request<unknown>(route, { method: 'POST', body: '{}' });
  const account = isRecord(payload) ? normalizeAccount(payload.account ?? payload) : null;
  return { account: account ?? undefined, jobId: extractJobId(payload) };
}

export async function deleteAccount(account: Account): Promise<MutationResult> {
  const payload = await request<unknown>(`/api/accounts/${account.id}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirm: true, expectedEmail: account.email }),
  });
  return { jobId: extractJobId(payload) };
}

export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.';
  if (error.code === 'NETWORK_ERROR' || error.status === 0) return 'Không thể kết nối backend. Hãy kiểm tra server đang chạy rồi thử lại.';
  if (error.code === 'PROFILE_BUSY' || error.status === 409) return 'Hồ sơ đang có tác vụ khác. Hãy chờ tác vụ hiện tại kết thúc.';
  if (error.code === 'INVALID_RESPONSE' || error.status === 502) return 'Backend trả về dữ liệu không hợp lệ. Chưa có thay đổi nào được giả định là thành công.';
  if (error.status === 400) return 'Dữ liệu chưa hợp lệ. Kiểm tra lại định dạng và thử lại.';
  if (error.status === 404) return 'Backend chưa cung cấp route này.';
  if (error.status >= 500) return 'Backend đang gặp lỗi. Vui lòng xem log server an toàn rồi thử lại.';
  return 'Thao tác chưa hoàn tất. Vui lòng thử lại.';
}
