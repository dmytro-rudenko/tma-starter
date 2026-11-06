import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { createTestDatabase, signInitData, TestDatabase } from '@dmytro-rudenko/tma-testing';
import { RealtimeService, TmaCoreModule, TmaRealtimeGateway, UsersService, migrations } from '../index';

const BOT = '123456:REALTIME-TEST';
const MAX_AGE_SEC = 3600;
const OLENA = { id: 777, first_name: 'Olena' };
const BLOCKED = { id: 778, first_name: 'Blocked' };

let db: TestDatabase;
let moduleRef: TestingModule;
let gateway: TmaRealtimeGateway;
let realtime: RealtimeService;

const nowSec = (): number => Math.floor(Date.now() / 1000);

function fakeSocket(initData: unknown) {
  return {
    handshake: { auth: { initData } },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    disconnect: jest.fn(),
  };
}

async function connect(socket: ReturnType<typeof fakeSocket>): Promise<void> {
  await expect(
    (async () => {
      await gateway.handleConnection(socket as never);
    })(),
  ).resolves.toBeUndefined();
}

function expectDropped(socket: ReturnType<typeof fakeSocket>): void {
  expect(socket.disconnect).toHaveBeenCalledWith(true);
  expect(socket.join).not.toHaveBeenCalled();
  expect(socket.data.userId).toBeUndefined();
}

function expectJoined(socket: ReturnType<typeof fakeSocket>, id: number): void {
  expect(socket.join).toHaveBeenCalledTimes(1);
  expect(socket.join).toHaveBeenCalledWith(`user:${id}`);
  expect(socket.data.userId).toBe(id);
  expect(socket.disconnect).not.toHaveBeenCalled();
}

beforeAll(async () => {
  db = await createTestDatabase({ migrations });
  await db.knex('users').insert({
    id: BLOCKED.id,
    first_name: BLOCKED.first_name,
    blocked_at: new Date('2026-03-04T05:06:07.000Z'),
  });
});

afterAll(async () => {
  await db?.drop();
});

beforeEach(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      TmaCoreModule.forRoot({
        knex: db.knex,
        botToken: BOT,
        adminUserIds: [1001],
        initDataMaxAgeSec: MAX_AGE_SEC,
        runWorker: false,
      }),
    ],
  }).compile();
  gateway = moduleRef.get(TmaRealtimeGateway);
  realtime = moduleRef.get(RealtimeService);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await moduleRef?.close();
});

describe('TmaRealtimeGateway options', () => {
  it('serves on /api/socket.io with a 10 000 byte buffer limit', () => {
    expect(Reflect.getMetadata(GATEWAY_OPTIONS, TmaRealtimeGateway)).toMatchObject({
      path: '/api/socket.io',
      maxHttpBufferSize: 10_000,
    });
  });
});

describe('TmaRealtimeGateway.handleConnection', () => {
  it('joins user:<id> for valid signed initData', async () => {
    const socket = fakeSocket(signInitData(OLENA, BOT));
    await connect(socket);
    expectJoined(socket, 777);
  });

  it('accepts initData younger than initDataMaxAgeSec', async () => {
    const socket = fakeSocket(signInitData(OLENA, BOT, { authDate: nowSec() - MAX_AGE_SEC + 60 }));
    await connect(socket);
    expectJoined(socket, 777);
  });

  it.each<[string, () => unknown]>([
    ['garbage', () => 'garbage'],
    ['an empty string', () => ''],
    ['a number', () => 42],
    ['undefined', () => undefined],
    [
      'a bad hash',
      () => {
        const p = new URLSearchParams(signInitData(OLENA, BOT));
        p.set('hash', 'f'.repeat(64));
        return p.toString();
      },
    ],
    ['another bot token', () => signInitData(OLENA, '999:OTHER')],
    ['an expired auth_date', () => signInitData(OLENA, BOT, { authDate: nowSec() - MAX_AGE_SEC - 60 })],
    ['an auth_date 120 s in the future', () => signInitData(OLENA, BOT, { authDate: nowSec() + 120 })],
  ])('disconnects on %s without joining', async (_label, initData) => {
    const socket = fakeSocket(initData());
    await connect(socket);
    expectDropped(socket);
  });

  it('disconnects a blocked user without joining', async () => {
    const socket = fakeSocket(signInitData(BLOCKED, BOT));
    await connect(socket);
    expectDropped(socket);
  });

  it('disconnects without joining when the blocked check fails', async () => {
    jest.spyOn(moduleRef.get(UsersService), 'isBlocked').mockRejectedValue(new Error('db down'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const socket = fakeSocket(signInitData(OLENA, BOT));
    await connect(socket);
    expectDropped(socket);
  });

  it('a reconnect with initData that has expired since the first connect is dropped and not joined', async () => {
    const first = fakeSocket(signInitData(OLENA, BOT));
    await connect(first);
    expectJoined(first, 777);

    const again = fakeSocket(signInitData(OLENA, BOT, { authDate: nowSec() - MAX_AGE_SEC - 60 }));
    await connect(again);
    expectDropped(again);
  });
});

describe('RealtimeService.emitToUser', () => {
  function fakeServer() {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    return { to, emit };
  }

  it('does nothing before the gateway is initialised', () => {
    expect(realtime.emitToUser(5, 'demo.ping', { n: 1 })).toBeUndefined();
  });

  it('emits to the user:<id> room once the gateway is initialised', () => {
    const server = fakeServer();
    gateway.afterInit(server as never);

    realtime.emitToUser(5, 'demo.ping', { n: 1 });

    expect(server.to).toHaveBeenCalledTimes(1);
    expect(server.to).toHaveBeenCalledWith('user:5');
    expect(server.emit).toHaveBeenCalledTimes(1);
    expect(server.emit).toHaveBeenCalledWith('demo.ping', { n: 1 });
  });

  it('logs instead of throwing when the server fails', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    gateway.afterInit({
      to: () => {
        throw new Error('adapter down');
      },
    } as never);

    expect(() => realtime.emitToUser(5, 'demo.ping', { n: 1 })).not.toThrow();
    expect(warn.mock.calls.length + error.mock.calls.length).toBe(1);
  });
});
