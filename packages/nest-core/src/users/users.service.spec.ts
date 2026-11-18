import { Test, TestingModule } from '@nestjs/testing';
import { createTestDatabase, TestDatabase } from '@dmytro-rudenko/tma-testing';
import { TmaCoreModule } from '../core.module';
import { migrations } from '../migrations';
import { UsersService } from './users.service';

const FIRST_ID = 3000;
const COUNT = 120;
const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');

let db: TestDatabase;
let moduleRef: TestingModule;
let users: UsersService;

beforeAll(async () => {
  db = await createTestDatabase({ migrations });
  moduleRef = await Test.createTestingModule({
    imports: [
      TmaCoreModule.forRoot({
        knex: db.knex,
        botToken: '123456:USERS-TEST',
        adminUserIds: [1001],
        runWorker: false,
      }),
    ],
  }).compile();
  users = moduleRef.get(UsersService);
  await db.knex('users').insert(
    Array.from({ length: COUNT }, (_, i) => ({
      id: FIRST_ID + i,
      first_name: `U${i}`,
      created_at: new Date(BASE_MS + i * 1000),
    })),
  );
});

afterAll(async () => {
  await moduleRef?.close();
  await db?.drop();
});

describe('UsersService.list limit clamp', () => {
  it.each<[number, number, number]>([
    [1000, 100, 3020],
    [101, 100, 3020],
    [100, 100, 3020],
    [1, 1, 3119],
    [0, 1, 3119],
    [-5, 1, 3119],
  ])('limit %i returns %i items, newest first, cursor at the last one', async (limit, size, lastId) => {
    const page = await users.list({ limit });
    expect(page.items).toHaveLength(size);
    expect(page.items[0].id).toBe(3119);
    expect(page.items[size - 1].id).toBe(lastId);
    expect(page.nextCursor).toMatch(new RegExp(`_${lastId}$`));
  });

  it('defaults to 50 items', async () => {
    const page = await users.list();
    expect(page.items).toHaveLength(50);
    expect(page.items[49].id).toBe(3070);
  });

  it('a clamped page continues from its cursor to the remaining 20 rows', async () => {
    const first = await users.list({ limit: 1000 });
    const second = await users.list({ limit: 1000, cursor: first.nextCursor });
    expect(second.items.map((u) => u.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => 3019 - i),
    );
    expect(second.nextCursor).toBeNull();
  });
});
