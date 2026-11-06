import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createTestDatabase, TestDatabase } from '@dmytro-rudenko/tma-testing';
import { AuditService, TmaCoreModule, TmaCoreOptions, migrations } from '../index';

const ACTOR = 1001;
const DAY_MS = 24 * 60 * 60 * 1000;

let db: TestDatabase;

function coreModule(extra: Partial<TmaCoreOptions> = {}) {
  return TmaCoreModule.forRoot({
    knex: db.knex,
    botToken: '123456:AUDIT-TEST',
    adminUserIds: [ACTOR],
    runWorker: false,
    ...extra,
  });
}

async function compile(extra: Partial<TmaCoreOptions> = {}): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [coreModule(extra)] }).compile();
}

async function insertAt(action: string, daysAgo: number): Promise<void> {
  await db.knex('audit_events').insert({
    action,
    at: db.knex.raw(`now() - make_interval(days => ?)`, [daysAgo]),
  });
}

async function actions(): Promise<string[]> {
  const rows = await db.knex('audit_events').orderBy('id').select('action');
  return rows.map((r: { action: string }) => r.action);
}

async function storedMeta(meta: unknown): Promise<unknown> {
  await db.knex('audit_events').del();
  await audit.record(db.knex, { actorId: ACTOR, action: 'meta.test', meta });
  const row = await db.knex('audit_events').where({ action: 'meta.test' }).first('meta');
  return row.meta;
}

let defaultRef: TestingModule;
let shortRef: TestingModule;
let audit: AuditService;
let shortAudit: AuditService;

beforeAll(async () => {
  db = await createTestDatabase({ migrations });
  defaultRef = await compile();
  shortRef = await compile({ auditRetentionDays: 7 });
  audit = defaultRef.get(AuditService);
  shortAudit = shortRef.get(AuditService);
});

afterAll(async () => {
  await defaultRef?.close();
  await shortRef?.close();
  await db?.drop();
});

beforeEach(async () => {
  await db.knex.raw('TRUNCATE audit_events');
});

describe('AuditService.record', () => {
  it('writes actor, action, target and meta', async () => {
    await audit.record(db.knex, {
      actorId: ACTOR,
      action: 'user.block',
      targetType: 'user',
      targetId: '42',
      meta: { reason: 'spam' },
    });
    const rows = await db.knex('audit_events');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].actor_id)).toBe(ACTOR);
    expect(rows[0]).toMatchObject({
      action: 'user.block',
      target_type: 'user',
      target_id: '42',
      meta: { reason: 'spam' },
    });
    expect(rows[0].at).toBeInstanceOf(Date);
  });

  it('stores null target and meta when they are omitted', async () => {
    await audit.record(db.knex, { actorId: ACTOR, action: 'settings.update' });
    const row = await db.knex('audit_events').first();
    expect(row).toMatchObject({ target_type: null, target_id: null, meta: null });
  });

  it('writes inside the given transaction and disappears with its rollback', async () => {
    await expect(
      db.knex.transaction(async (trx) => {
        await audit.record(trx, { actorId: ACTOR, action: 'user.block', targetId: '7' });
        expect(await trx('audit_events')).toHaveLength(1);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.knex('audit_events')).toHaveLength(0);
  });

  it('rejects when the insert fails instead of swallowing the error', async () => {
    await db.knex.raw(
      "ALTER TABLE audit_events ADD CONSTRAINT test_no_fail CHECK (action <> 'audit.fail') NOT VALID",
    );
    try {
      await expect(audit.record(db.knex, { actorId: ACTOR, action: 'audit.fail' })).rejects.toBeDefined();
    } finally {
      await db.knex.raw('ALTER TABLE audit_events DROP CONSTRAINT test_no_fail');
    }
    expect(await db.knex('audit_events')).toHaveLength(0);
  });
});

describe('AuditService.record meta limit of 4096 JSON bytes', () => {
  it('keeps meta of exactly 4096 bytes as is', async () => {
    const meta = { s: 'a'.repeat(4088) };
    expect(Buffer.byteLength(JSON.stringify(meta))).toBe(4096);
    expect(await storedMeta(meta)).toEqual(meta);
  });

  it('shortens strings to 200 chars plus an ellipsis at 4097 bytes', async () => {
    const meta = { s: 'a'.repeat(4089) };
    expect(Buffer.byteLength(JSON.stringify(meta))).toBe(4097);
    expect(await storedMeta(meta)).toEqual({ s: 'a'.repeat(200) + '…' });
  });

  it('counts bytes, not characters', async () => {
    const meta = { s: 'ї'.repeat(2045) };
    expect(JSON.stringify(meta).length).toBe(2053);
    expect(await storedMeta(meta)).toEqual({ s: 'ї'.repeat(200) + '…' });
  });

  it('shortens nested strings in objects and arrays', async () => {
    expect(
      await storedMeta({ deep: { list: ['b'.repeat(5000), 'ok'] }, flag: true }),
    ).toEqual({ deep: { list: ['b'.repeat(200) + '…', 'ok'] }, flag: true });
  });

  it('replaces meta with { truncated, bytes } when shortening is not enough', async () => {
    const meta = { items: Array.from({ length: 1000 }, () => 'abcdefgh') };
    expect(Buffer.byteLength(JSON.stringify(meta))).toBe(11011);
    expect(await storedMeta(meta)).toEqual({ truncated: true, bytes: 11011 });
  });
});

describe('AuditService.prune', () => {
  it('deletes rows older than the default 90 days', async () => {
    await insertAt('d91', 91);
    await insertAt('d89', 89);
    await insertAt('d0', 0);
    await audit.prune();
    expect(await actions()).toEqual(['d89', 'd0']);
  });

  it('honours auditRetentionDays', async () => {
    await insertAt('d8', 8);
    await insertAt('d6', 6);
    await insertAt('d0', 0);
    await shortAudit.prune();
    expect(await actions()).toEqual(['d6', 'd0']);
  });
});

describe('AuditService prune schedule', () => {
  let ref: TestingModule | undefined;

  async function boot(runWorker: boolean, prune: () => Promise<unknown>) {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const spy = jest.spyOn(AuditService.prototype, 'prune').mockImplementation(prune as never);
    ref = await compile({ runWorker });
    await ref.init();
    return spy;
  }

  afterEach(async () => {
    await ref?.close();
    ref = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('prunes every 24 h when runWorker is on and stops on module close', async () => {
    const spy = await boot(true, async () => undefined);
    const base = spy.mock.calls.length;
    expect([0, 1]).toContain(base);

    await jest.advanceTimersByTimeAsync(DAY_MS - 1);
    expect(spy).toHaveBeenCalledTimes(base);
    await jest.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(base + 1);
    await jest.advanceTimersByTimeAsync(DAY_MS);
    expect(spy).toHaveBeenCalledTimes(base + 2);

    await ref!.close();
    ref = undefined;
    await jest.advanceTimersByTimeAsync(2 * DAY_MS);
    expect(spy).toHaveBeenCalledTimes(base + 2);
  });

  it('never prunes when runWorker is off', async () => {
    const spy = await boot(false, async () => undefined);
    await jest.advanceTimersByTimeAsync(2 * DAY_MS);
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs a prune failure and keeps the schedule', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const spy = await boot(true, async () => {
      throw new Error('prune boom');
    });
    const base = spy.mock.calls.length;

    await jest.advanceTimersByTimeAsync(DAY_MS);
    expect(spy).toHaveBeenCalledTimes(base + 1);
    expect(warn.mock.calls.length + error.mock.calls.length).toBeGreaterThanOrEqual(base + 1);

    await jest.advanceTimersByTimeAsync(DAY_MS);
    expect(spy).toHaveBeenCalledTimes(base + 2);
  });
});
