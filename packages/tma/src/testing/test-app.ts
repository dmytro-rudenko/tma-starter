import type { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import type { Knex } from 'knex';
import supertest = require('supertest');
import { createTestDatabase, TestDatabase } from './database';
import { FakeBotApi, startFakeBotApi } from './fake-bot-api';
import { signInitData, TgUserInput } from './init-data';

export interface TestAppContext {
  knex: Knex;
  botToken: string;
  apiRoot: string;
  databaseUrl: string;
}

export interface CreateTestAppOptions {
  imports: (ctx: TestAppContext) => any[];
  migrations: Knex.MigrationSource<any>;
  overrides?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  botToken?: string;
}

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof supertest>;
  knex: Knex;
  fakeBot: FakeBotApi;
  botToken: string;
  tokenFor(user: TgUserInput): string;
  close(): Promise<void>;
}

type IoAdapterCtor = new (app: INestApplication) => any;

function loadIoAdapter(): IoAdapterCtor | undefined {
  try {
    return (require('@nestjs/platform-socket.io') as { IoAdapter: IoAdapterCtor }).IoAdapter;
  } catch {
    return undefined;
  }
}

export async function createTestApp(opts: CreateTestAppOptions): Promise<TestApp> {
  const botToken = opts.botToken ?? '123456:test-token';
  const fakeBot = await startFakeBotApi();
  let db: TestDatabase | undefined;
  let app: INestApplication | undefined;
  try {
    db = await createTestDatabase({ migrations: opts.migrations });
    const ctx: TestAppContext = {
      knex: db.knex,
      botToken,
      apiRoot: fakeBot.url,
      databaseUrl: db.url,
    };
    let builder = Test.createTestingModule({ imports: opts.imports(ctx) });
    if (opts.overrides) builder = opts.overrides(builder);
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    const IoAdapter = loadIoAdapter();
    if (IoAdapter) app.useWebSocketAdapter(new IoAdapter(app));
    await app.init();
  } catch (err) {
    await app?.close().catch(() => undefined);
    await fakeBot.close();
    await db?.drop().catch(() => undefined);
    throw err;
  }

  const ready = app;
  const database = db;
  return {
    app: ready,
    http: supertest(ready.getHttpServer()),
    knex: database.knex,
    fakeBot,
    botToken,
    tokenFor: (user) => signInitData(user, botToken),
    close: async () => {
      try {
        await ready.close();
      } finally {
        await fakeBot.close();
        await database.drop();
      }
    },
  };
}
