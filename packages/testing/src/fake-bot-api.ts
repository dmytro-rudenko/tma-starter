import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';

export interface FakeBotCall {
  method: string;
  body: any;
}

export type FakeBotReply =
  | { ok: true; result: unknown }
  | {
      ok: false;
      error_code: number;
      description: string;
      parameters?: { retry_after?: number; migrate_to_chat_id?: number };
    };

export interface FakeBotApi {
  url: string;
  readonly calls: FakeBotCall[];
  callsOf(method: string): FakeBotCall[];
  reset(): void;
  respond(method: string, reply: FakeBotReply, opts?: { times?: number }): void;
  blockedByUser(method: string): void;
  tooManyRequests(method: string, retryAfter: number): void;
  badRequest(method: string, description: string): void;
  close(): Promise<void>;
}

function parseMultipart(raw: Buffer, contentType: string): Record<string, unknown> {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return {};
  const boundary = '--' + (m[1] ?? m[2]);
  const out: Record<string, unknown> = {};
  for (const part of raw.toString('latin1').split(boundary)) {
    const sep = part.indexOf('\r\n\r\n');
    if (sep < 0) continue;
    const headers = part.slice(0, sep);
    const name = /name="([^"]+)"/i.exec(headers)?.[1];
    if (!name) continue;
    let value = part.slice(sep + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    if (/filename="/i.test(headers)) {
      out[name] = { file: true, size: value.length };
      continue;
    }
    const text = Buffer.from(value, 'latin1').toString('utf8');
    try {
      out[name] = JSON.parse(text);
    } catch {
      out[name] = text;
    }
  }
  return out;
}

function parseBody(raw: Buffer, contentType: string): any {
  if (raw.length === 0) return {};
  if (/multipart\/form-data/i.test(contentType)) return parseMultipart(raw, contentType);
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return raw.toString('utf8');
  }
}

export async function startFakeBotApi({ port = 0 }: { port?: number } = {}): Promise<FakeBotApi> {
  const calls: FakeBotCall[] = [];
  const sticky = new Map<string, FakeBotReply>();
  const timed = new Map<string, { reply: FakeBotReply; remaining: number }[]>();
  let messageId = 0;
  let invoiceN = 0;
  let preparedN = 0;

  const defaultResult = (method: string, body: any): unknown => {
    switch (method) {
      case 'sendMessage':
        return {
          message_id: ++messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: body?.chat_id, type: 'private' },
          text: body?.text,
        };
      case 'createInvoiceLink':
        return `https://t.me/$fake/${++invoiceN}`;
      case 'savePreparedInlineMessage':
        return { id: `prep-${++preparedN}`, expiration_date: 4102444800 };
      case 'getStarTransactions':
        return { transactions: [] };
      default:
        return true;
    }
  };

  const replyFor = (method: string, body: any): FakeBotReply => {
    const queue = timed.get(method);
    const next = queue?.find((e) => e.remaining > 0);
    if (next) {
      next.remaining -= 1;
      return next.reply;
    }
    return sticky.get(method) ?? { ok: true, result: defaultResult(method, body) };
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const match = /^\/bot[^/]+\/([A-Za-z]+)/.exec(req.url ?? '');
      if (!match) {
        send(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
        return;
      }
      const method = match[1];
      const body = parseBody(Buffer.concat(chunks), String(req.headers['content-type'] ?? ''));
      calls.push({ method, body });
      const reply = replyFor(method, body);
      send(res, reply.ok ? 200 : reply.error_code, reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${actual}`,
    calls,
    callsOf: (method) => calls.filter((c) => c.method === method),
    reset: () => {
      calls.length = 0;
      sticky.clear();
      timed.clear();
    },
    respond: (method, reply, opts = {}) => {
      if (opts.times === undefined) {
        sticky.set(method, reply);
        return;
      }
      const queue = timed.get(method) ?? [];
      queue.push({ reply, remaining: opts.times });
      timed.set(method, queue);
    },
    blockedByUser: (method) => {
      sticky.set(method, {
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      });
    },
    tooManyRequests: (method, retryAfter) => {
      sticky.set(method, {
        ok: false,
        error_code: 429,
        description: `Too Many Requests: retry after ${retryAfter}`,
        parameters: { retry_after: retryAfter },
      });
    },
    badRequest: (method, description) => {
      sticky.set(method, { ok: false, error_code: 400, description });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
