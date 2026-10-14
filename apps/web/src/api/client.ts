import { ApiError, NetworkError } from './errors';
import type { HistoryFilter, LoginResponse, RegisterInput, Transaction, TransactionInput, User } from './types';

const apiUrl = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  try {
    let response: Response;
    try {
      response = await fetch(`${apiUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch {
      throw new NetworkError(options.method === 'POST' && path === '/v1/transactions');
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (response.ok) throw new NetworkError(options.method === 'POST' && path === '/v1/transactions');
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'El servicio no pudo completar la solicitud.');
    }

    if (!response.ok) {
      const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      const fields = payload.fields && typeof payload.fields === 'object'
        ? Object.fromEntries(Object.entries(payload.fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {};
      throw new ApiError(
        response.status,
        typeof payload.code === 'string' ? payload.code : 'REQUEST_FAILED',
        typeof payload.message === 'string' ? payload.message : 'No pudimos completar la solicitud.',
        fields,
        typeof payload.requestId === 'string' ? payload.requestId : undefined,
      );
    }

    return data as T;
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export const api = {
  register: (body: RegisterInput, signal?: AbortSignal) => request<User>('/v1/auth/register', { method: 'POST', body, signal }),
  login: (email: string, password: string, signal?: AbortSignal) => request<LoginResponse>('/v1/auth/login', { method: 'POST', body: { email, password }, signal }),
  createTransaction: (body: TransactionInput, token: string, signal?: AbortSignal) => request<Transaction>('/v1/transactions', { method: 'POST', body, token, signal }),
  history: (filter: HistoryFilter, token: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ startDate: filter.startDate, endDate: filter.endDate });
    if (filter.userId) params.set('userId', filter.userId);
    return request<Transaction[]>(`/v1/transactions/history?${params}`, { token, signal });
  },
};
