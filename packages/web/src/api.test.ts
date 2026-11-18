import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { ApiError, createApiClient } from '@dmytro-rudenko/tma-web';

function stubResponse(res: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function failureOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).Telegram;
});

describe('createApiClient responses', () => {
  it('parses a JSON body', async () => {
    stubResponse(
      new Response(JSON.stringify({ items: [1, 2], total: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(createApiClient().request('/api/products')).resolves.toEqual({ items: [1, 2], total: 2 });
  });

  it('returns a non-JSON body as text', async () => {
    stubResponse(new Response('pong', { status: 200, headers: { 'content-type': 'text/plain' } }));
    await expect(createApiClient().request('/api/ping')).resolves.toBe('pong');
  });

  it('returns undefined for an empty body', async () => {
    stubResponse(new Response(null, { status: 204 }));
    await expect(createApiClient().request('/api/subscription/cancel', { method: 'POST' })).resolves.toBeUndefined();
  });

  it("uses '' baseUrl by default and sends 'tma ' outside Telegram", async () => {
    const fetchMock = stubResponse(new Response(null, { status: 204 }));
    await createApiClient().request('/api/me');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/me');
    expect((init?.headers as Record<string, string>).Authorization).toBe('tma ');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('passes a raw body and extra headers through without forcing JSON', async () => {
    installFakeWebApp(window, { initData: 'auth_date=1&hash=x' });
    const fetchMock = stubResponse(new Response(null, { status: 204 }));
    await createApiClient({ baseUrl: 'https://api.test' }).request('/api/upload', {
      method: 'PUT',
      body: 'raw-bytes',
      headers: { 'X-Trace': 't-1' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.test/api/upload');
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('raw-bytes');
    expect(headers.get('X-Trace')).toBe('t-1');
    expect(headers.get('Authorization')).toBe('tma auth_date=1&hash=x');
    expect(headers.get('Content-Type')).toBeNull();
  });
});

describe('ApiError', () => {
  it('falls back to HTTP_<status> when the body has no code', async () => {
    stubResponse(
      new Response(JSON.stringify({ statusCode: 500, message: 'boom', error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const err = await failureOf(createApiClient().request('/api/me'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, code: 'HTTP_500', message: 'boom' });
  });

  it('falls back to HTTP_<status> for a non-JSON error body', async () => {
    stubResponse(new Response('upstream down', { status: 502, statusText: 'Bad Gateway' }));
    const err = await failureOf(createApiClient().request('/api/me'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: 'HTTP_502' });
  });

  it('falls back to HTTP_<status> for an empty error body', async () => {
    stubResponse(new Response(null, { status: 503 }));
    const err = await failureOf(createApiClient().request('/api/me'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, code: 'HTTP_503' });
  });

  it('joins an array message from validation errors', async () => {
    stubResponse(
      new Response(
        JSON.stringify({
          statusCode: 400,
          message: ['theme must be one of system, light, dark', 'language must be a string'],
          error: 'Bad Request',
          code: 'VALIDATION',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    const err = await failureOf(createApiClient().request('/api/me', { method: 'PATCH', json: { theme: 'neon' } }));
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION',
      message: 'theme must be one of system, light, dark; language must be a string',
    });
  });

  it('is an Error', async () => {
    stubResponse(
      new Response(JSON.stringify({ statusCode: 404, message: 'nope', error: 'Not Found', code: 'USER_NOT_FOUND' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const err = await failureOf(createApiClient().request('/api/admin/users/9'));
    expect(err).toBeInstanceOf(Error);
    expect((err as ApiError).code).toBe('USER_NOT_FOUND');
  });
});
