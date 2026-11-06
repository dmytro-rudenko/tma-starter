import { tg } from './tg.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
}

export interface ApiClient {
  request<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
}

export function createApiClient({ baseUrl = '' }: { baseUrl?: string } = {}): ApiClient {
  return {
    async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
      const headers: Record<string, string> = {
        Authorization: `tma ${tg.initDataRaw()}`,
        ...opts.headers,
      };
      let body = opts.body;
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      }
      const res = await fetch(`${baseUrl}${path}`, { method: opts.method ?? 'GET', headers, body });
      const text = await res.text();
      let data: unknown = undefined;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) {
        const err = (data && typeof data === 'object' ? data : {}) as {
          code?: unknown;
          message?: unknown;
        };
        const message = Array.isArray(err.message)
          ? err.message.join('; ')
          : typeof err.message === 'string'
            ? err.message
            : res.statusText || `HTTP ${res.status}`;
        const code = typeof err.code === 'string' && err.code ? err.code : `HTTP_${res.status}`;
        throw new ApiError(res.status, code, message);
      }
      return data as T;
    },
  };
}
