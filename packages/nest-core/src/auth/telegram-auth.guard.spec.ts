import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { signInitData } from '@dmytro-rudenko/tma-testing';
import { resolveCoreOptions } from '../options';
import type { UsersService } from '../users/users.service';
import { Public } from './public.decorator';
import { TelegramAuthGuard } from './telegram-auth.guard';

const BOT = '123456:GUARD-TEST';
const tgUser = { id: 4242, first_name: 'Olena', username: 'olena', language_code: 'uk' };

class Handlers {
  guarded(): void {}

  @Public()
  open(): void {}
}

const upserted: number[] = [];
const users = {
  upsert: async (from: { id: number }) => {
    upserted.push(from.id);
    return { id: from.id, blockedAt: null };
  },
} as unknown as UsersService;

const guard = new TelegramAuthGuard(
  new Reflector(),
  resolveCoreOptions({ knex: {} as never, botToken: BOT, adminUserIds: [], runWorker: false }),
  users,
);

function ctx(path: string, handler: keyof Handlers, authorization?: string) {
  const req = { path, headers: authorization ? { authorization } : {} } as Record<string, any>;
  const host = new ExecutionContextHost([req, {}, () => undefined], Handlers, Handlers.prototype[handler]);
  host.setType('http');
  return { host, req };
}

async function expectUnauthorized(p: Promise<boolean>): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  expect((err as HttpException).getStatus()).toBe(401);
  expect((err as HttpException).getResponse()).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
}

beforeEach(() => {
  upserted.length = 0;
});

describe('TelegramAuthGuard path scope', () => {
  it('requires initData for path exactly /api', async () => {
    await expectUnauthorized(guard.canActivate(ctx('/api', 'guarded').host));
  });

  it('requires initData for /API/x (case-insensitive)', async () => {
    await expectUnauthorized(guard.canActivate(ctx('/API/x', 'guarded').host));
  });

  it('requires initData for /api/me', async () => {
    await expectUnauthorized(guard.canActivate(ctx('/api/me', 'guarded').host));
  });

  it('skips /bot/x without a header', async () => {
    await expect(guard.canActivate(ctx('/bot/x', 'guarded').host)).resolves.toBe(true);
  });

  it('skips non-/api paths like /health and /apix', async () => {
    await expect(guard.canActivate(ctx('/health', 'guarded').host)).resolves.toBe(true);
    await expect(guard.canActivate(ctx('/apix', 'guarded').host)).resolves.toBe(true);
    expect(upserted).toEqual([]);
  });
});

describe('TelegramAuthGuard @Public', () => {
  it('lets a @Public() handler under /api pass without a header', async () => {
    await expect(guard.canActivate(ctx('/api/health', 'open').host)).resolves.toBe(true);
    expect(upserted).toEqual([]);
  });
});

describe('TelegramAuthGuard valid initData', () => {
  it('upserts the user and sets req.user for /api with a valid header', async () => {
    const { host, req } = ctx('/api', 'guarded', 'tma ' + signInitData(tgUser, BOT));
    await expect(guard.canActivate(host)).resolves.toBe(true);
    expect(upserted).toEqual([4242]);
    expect(req.user).toEqual({ id: 4242, firstName: 'Olena', username: 'olena', languageCode: 'uk' });
  });
});
