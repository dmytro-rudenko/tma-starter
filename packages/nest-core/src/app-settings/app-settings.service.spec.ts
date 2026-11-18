import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createTestDatabase, TestDatabase } from '@dmytro-rudenko/tma-testing';
import {
  APP_SETTINGS_CLOCK,
  AppSettingsRegistry,
  AppSettingsService,
  TmaCoreModule,
  defineSetting,
  migrations,
} from '../index';

const T0 = 1_000_000;
const ACTOR = 1001;

let db: TestDatabase;
let moduleRef: TestingModule;
let settings: AppSettingsService;
let now: number;
const clock = (): number => now;

async function expectApiError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  const http = err as HttpException;
  expect(http.getStatus()).toBe(status);
  expect(http.getResponse()).toMatchObject({ statusCode: status, code });
}

async function storeDirect(key: string, value: unknown): Promise<void> {
  await db
    .knex('app_settings')
    .insert({ key, value: JSON.stringify(value) })
    .onConflict('key')
    .merge();
}

beforeAll(async () => {
  db = await createTestDatabase({ migrations });
});

afterAll(async () => {
  await db?.drop();
});

beforeEach(async () => {
  now = T0;
  await db.knex.raw('TRUNCATE app_settings, audit_events');
  moduleRef = await Test.createTestingModule({
    imports: [
      TmaCoreModule.forRoot({
        knex: db.knex,
        botToken: '123456:SETTINGS-TEST',
        adminUserIds: [ACTOR],
        runWorker: false,
      }),
    ],
  })
    .overrideProvider(APP_SETTINGS_CLOCK)
    .useValue(clock)
    .compile();
  const registry = moduleRef.get(AppSettingsRegistry);
  registry.register(
    defineSetting<number>({
      key: 'demo.limit',
      default: 5,
      parse: (v: unknown) => {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          throw new Error('demo.limit must be a non-negative integer');
        }
        return v;
      },
    }),
  );
  registry.register(
    defineSetting<string>({
      key: 'demo.title',
      default: 'Hi',
      parse: (v: unknown) => {
        if (typeof v !== 'string') throw new Error('demo.title must be a string');
        return v.trim();
      },
    }),
  );
  settings = moduleRef.get(AppSettingsService);
});

afterEach(async () => {
  await moduleRef?.close();
});

describe('AppSettingsService.get', () => {
  it('returns the default when no row exists', async () => {
    expect(await settings.get<number>('demo.limit')).toBe(5);
    expect(await settings.get<string>('demo.title')).toBe('Hi');
  });

  it('returns the stored value when a row exists', async () => {
    await storeDirect('demo.limit', 9);
    expect(await settings.get<number>('demo.limit')).toBe(9);
  });

  it('a direct DB change stays hidden until the 30 s cache expires', async () => {
    expect(await settings.get<number>('demo.limit')).toBe(5);
    await storeDirect('demo.limit', 9);

    now = T0 + 29_999;
    expect(await settings.get<number>('demo.limit')).toBe(5);

    now = T0 + 30_001;
    expect(await settings.get<number>('demo.limit')).toBe(9);
  });

  it('caches the whole table, not just the key that was read', async () => {
    expect(await settings.get<number>('demo.limit')).toBe(5);
    await storeDirect('demo.title', 'Direct');

    now = T0 + 1;
    expect(await settings.get<string>('demo.title')).toBe('Hi');

    now = T0 + 30_001;
    expect(await settings.get<string>('demo.title')).toBe('Direct');
  });

  it('rejects an unregistered key with 400 UNKNOWN_SETTING', async () => {
    await expectApiError(settings.get('nope.unknown'), 400, 'UNKNOWN_SETTING');
  });
});

describe('AppSettingsService.set', () => {
  it('stores the parsed value and makes it visible at once despite a cached read', async () => {
    expect(await settings.get<string>('demo.title')).toBe('Hi');

    await settings.set(ACTOR, 'demo.title', '  Hello  ');

    expect(await settings.get<string>('demo.title')).toBe('Hello');
    const row = await db.knex('app_settings').where({ key: 'demo.title' }).first('value');
    expect(row?.value).toBe('Hello');
  });

  it('keeps one row per key and writes settings.update { from, to } for each change', async () => {
    await settings.set(ACTOR, 'demo.limit', 7);
    await settings.set(ACTOR, 'demo.limit', 9);

    expect(await settings.get<number>('demo.limit')).toBe(9);
    expect(await db.knex('app_settings').where({ key: 'demo.limit' })).toHaveLength(1);

    const audit = await db.knex('audit_events').where({ action: 'settings.update' }).orderBy('id');
    expect(audit).toHaveLength(2);
    expect(Number(audit[0].actor_id)).toBe(ACTOR);
    expect(audit[0].meta).toHaveProperty('from');
    expect(audit[0].meta.to).toBe(7);
    expect(Number(audit[1].actor_id)).toBe(ACTOR);
    expect(audit[1].meta).toEqual({ from: 7, to: 9 });
  });

  it('rejects an unregistered key with 400 UNKNOWN_SETTING and writes nothing', async () => {
    await expectApiError(settings.set(ACTOR, 'nope.unknown', 1), 400, 'UNKNOWN_SETTING');
    expect(await db.knex('app_settings')).toHaveLength(0);
    expect(await db.knex('audit_events')).toHaveLength(0);
  });

  it('rejects a value that parse throws on with 400 VALIDATION and writes nothing', async () => {
    expect(await settings.get<number>('demo.limit')).toBe(5);

    await expectApiError(settings.set(ACTOR, 'demo.limit', 'many'), 400, 'VALIDATION');
    await expectApiError(settings.set(ACTOR, 'demo.limit', -1), 400, 'VALIDATION');

    expect(await db.knex('app_settings')).toHaveLength(0);
    expect(await db.knex('audit_events')).toHaveLength(0);
    expect(await settings.get<number>('demo.limit')).toBe(5);
  });

  it('rolls the value back when the audit write fails', async () => {
    await db.knex.raw(
      "ALTER TABLE audit_events ADD CONSTRAINT test_no_settings CHECK (action <> 'settings.update') NOT VALID",
    );
    try {
      await expect(settings.set(ACTOR, 'demo.limit', 7)).rejects.toBeDefined();
    } finally {
      await db.knex.raw('ALTER TABLE audit_events DROP CONSTRAINT test_no_settings');
    }
    expect(await db.knex('app_settings')).toHaveLength(0);
    expect(await settings.get<number>('demo.limit')).toBe(5);
  });
});
