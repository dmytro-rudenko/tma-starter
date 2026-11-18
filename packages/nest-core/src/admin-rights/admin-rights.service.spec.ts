import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createTestDatabase, TestDatabase } from '@dmytro-rudenko/tma-testing';
import { TmaCoreModule } from '../core.module';
import { migrations } from '../migrations';
import { UsersService } from '../users/users.service';
import { AdminRightsService } from './admin-rights.service';

const ENV = 1001;
const ENV2 = 1002;
const PLAIN = 2001;
const GRANTED = 2002;
const BLOCKED = 2003;
const GRANTED_BLOCKED = 2004;
const MISSING = 999999;
const GRANTED_AT = new Date('2026-01-02T03:04:05.000Z');
const BLOCKED_AT = new Date('2026-02-03T04:05:06.000Z');

let db: TestDatabase;
let moduleRef: TestingModule;
let rights: AdminRightsService;
let users: UsersService;

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

async function row(id: number) {
  return db.knex('users').where({ id }).first();
}

beforeAll(async () => {
  db = await createTestDatabase({ migrations });
  moduleRef = await Test.createTestingModule({
    imports: [
      TmaCoreModule.forRoot({
        knex: db.knex,
        botToken: '123456:RIGHTS-TEST',
        adminUserIds: [ENV, ENV2],
        runWorker: false,
      }),
    ],
  }).compile();
  rights = moduleRef.get(AdminRightsService);
  users = moduleRef.get(UsersService);
});

afterAll(async () => {
  await moduleRef?.close();
  await db?.drop();
});

beforeEach(async () => {
  await db.knex.raw('TRUNCATE users CASCADE');
  await db.knex('users').insert([
    { id: ENV, first_name: 'Env' },
    { id: ENV2, first_name: 'Env2' },
    { id: PLAIN, first_name: 'Plain' },
    { id: GRANTED, first_name: 'Granted', admin_granted_at: GRANTED_AT, admin_granted_by: ENV },
    { id: BLOCKED, first_name: 'Blocked', blocked_at: BLOCKED_AT },
    {
      id: GRANTED_BLOCKED,
      first_name: 'GrantedBlocked',
      admin_granted_at: GRANTED_AT,
      admin_granted_by: ENV,
      blocked_at: BLOCKED_AT,
    },
  ]);
});

describe('AdminRightsService.isAdmin / source', () => {
  it('reports env for an adminUserIds user, granted for admin_granted_at, null otherwise', async () => {
    expect(await rights.isAdmin(ENV)).toBe(true);
    expect(await rights.source(ENV)).toBe('env');
    expect(await rights.isAdmin(GRANTED)).toBe(true);
    expect(await rights.source(GRANTED)).toBe('granted');
    expect(await rights.isAdmin(PLAIN)).toBe(false);
    expect(await rights.source(PLAIN)).toBeNull();
    expect(await rights.isAdmin(MISSING)).toBe(false);
    expect(await rights.source(MISSING)).toBeNull();
  });

  it('gives env priority over a grant', async () => {
    await db.knex('users').where({ id: ENV2 }).update({ admin_granted_at: GRANTED_AT });
    expect(await rights.source(ENV2)).toBe('env');
  });

  it('reports an env admin as env even without a users row', async () => {
    await db.knex('users').where({ id: ENV2 }).delete();
    expect(await rights.isAdmin(ENV2)).toBe(true);
    expect(await rights.source(ENV2)).toBe('env');
  });
});

describe('AdminRightsService.grant', () => {
  it('sets admin_granted_at and admin_granted_by for a plain user', async () => {
    await rights.grant(ENV, PLAIN);
    const r = await row(PLAIN);
    expect(r.admin_granted_at).toBeInstanceOf(Date);
    expect(Number(r.admin_granted_by)).toBe(ENV);
    expect(await rights.source(PLAIN)).toBe('granted');
  });

  it('throws 404 USER_NOT_FOUND for a missing user', async () => {
    await expectApiError(rights.grant(ENV, MISSING), 404, 'USER_NOT_FOUND');
  });

  it('checks USER_NOT_FOUND before CANNOT_TARGET_SELF', async () => {
    await expectApiError(rights.grant(MISSING, MISSING), 404, 'USER_NOT_FOUND');
  });

  it('throws 409 CANNOT_GRANT_BLOCKED for a blocked user and leaves the row unchanged', async () => {
    await expectApiError(rights.grant(ENV, BLOCKED), 409, 'CANNOT_GRANT_BLOCKED');
    expect((await row(BLOCKED)).admin_granted_at).toBeNull();
  });

  it('checks CANNOT_GRANT_BLOCKED before the no-op on an already granted blocked user', async () => {
    await expectApiError(rights.grant(ENV, GRANTED_BLOCKED), 409, 'CANNOT_GRANT_BLOCKED');
  });

  it('is a no-op for an already granted user: resolves and keeps the original grant', async () => {
    await expect(rights.grant(ENV2, GRANTED)).resolves.toBeDefined();
    const r = await row(GRANTED);
    expect(r.admin_granted_at.toISOString()).toBe(GRANTED_AT.toISOString());
    expect(Number(r.admin_granted_by)).toBe(ENV);
  });

  it('is a no-op for an env admin: no grant is written', async () => {
    await expect(rights.grant(ENV, ENV2)).resolves.toBeDefined();
    expect((await row(ENV2)).admin_granted_at).toBeNull();
    expect(await rights.source(ENV2)).toBe('env');
  });
});

describe('AdminRightsService.revoke', () => {
  it('clears admin_granted_at for a granted user', async () => {
    await rights.revoke(ENV, GRANTED);
    expect((await row(GRANTED)).admin_granted_at).toBeNull();
    expect(await rights.source(GRANTED)).toBeNull();
    expect(await rights.isAdmin(GRANTED)).toBe(false);
  });

  it('throws 404 USER_NOT_FOUND for a missing user', async () => {
    await expectApiError(rights.revoke(ENV, MISSING), 404, 'USER_NOT_FOUND');
  });

  it('checks USER_NOT_FOUND before CANNOT_TARGET_SELF', async () => {
    await expectApiError(rights.revoke(MISSING, MISSING), 404, 'USER_NOT_FOUND');
  });

  it('throws 409 CANNOT_TARGET_SELF for a granted admin revoking themself', async () => {
    await expectApiError(rights.revoke(GRANTED, GRANTED), 409, 'CANNOT_TARGET_SELF');
    expect((await row(GRANTED)).admin_granted_at).not.toBeNull();
  });

  it('checks CANNOT_TARGET_SELF before CANNOT_REVOKE_ENV_ADMIN', async () => {
    await expectApiError(rights.revoke(ENV, ENV), 409, 'CANNOT_TARGET_SELF');
  });

  it('throws 409 CANNOT_REVOKE_ENV_ADMIN for an env admin', async () => {
    await expectApiError(rights.revoke(ENV, ENV2), 409, 'CANNOT_REVOKE_ENV_ADMIN');
  });

  it('checks env before the grant: an env admin with a grant keeps it', async () => {
    await db.knex('users').where({ id: ENV2 }).update({ admin_granted_at: GRANTED_AT });
    await expectApiError(rights.revoke(ENV, ENV2), 409, 'CANNOT_REVOKE_ENV_ADMIN');
    expect((await row(ENV2)).admin_granted_at.toISOString()).toBe(GRANTED_AT.toISOString());
  });

  it('is a no-op for a plain user', async () => {
    await expect(rights.revoke(ENV, PLAIN)).resolves.toBeDefined();
    expect((await row(PLAIN)).admin_granted_at).toBeNull();
  });
});

describe('UsersService.block / unblock under the admin rules', () => {
  it('blocks a plain user', async () => {
    await users.block(ENV, PLAIN);
    expect((await row(PLAIN)).blocked_at).toBeInstanceOf(Date);
    expect(await users.isBlocked(PLAIN)).toBe(true);
  });

  it('throws 404 USER_NOT_FOUND for a missing user', async () => {
    await expectApiError(users.block(ENV, MISSING), 404, 'USER_NOT_FOUND');
    await expectApiError(users.unblock(ENV, MISSING), 404, 'USER_NOT_FOUND');
  });

  it('checks USER_NOT_FOUND before CANNOT_TARGET_SELF', async () => {
    await expectApiError(users.block(MISSING, MISSING), 404, 'USER_NOT_FOUND');
  });

  it('checks CANNOT_TARGET_SELF before the env rule', async () => {
    await expectApiError(users.block(ENV, ENV), 409, 'CANNOT_TARGET_SELF');
    expect((await row(ENV)).blocked_at).toBeNull();
  });

  it('checks CANNOT_TARGET_SELF before the grant rule', async () => {
    await expectApiError(users.block(GRANTED, GRANTED), 409, 'CANNOT_TARGET_SELF');
    expect((await row(GRANTED)).blocked_at).toBeNull();
  });

  it('throws 409 CANNOT_BLOCK_ADMIN for an env admin', async () => {
    await expectApiError(users.block(ENV, ENV2), 409, 'CANNOT_BLOCK_ADMIN');
    expect((await row(ENV2)).blocked_at).toBeNull();
  });

  it('throws 409 CANNOT_BLOCK_ADMIN for a granted admin until the grant is revoked', async () => {
    await expectApiError(users.block(ENV, GRANTED), 409, 'CANNOT_BLOCK_ADMIN');
    expect((await row(GRANTED)).blocked_at).toBeNull();

    await rights.revoke(ENV, GRANTED);
    await users.block(ENV, GRANTED);
    expect((await row(GRANTED)).blocked_at).toBeInstanceOf(Date);
  });

  it('checks the grant before the no-op on an already blocked granted user', async () => {
    await expectApiError(users.block(ENV, GRANTED_BLOCKED), 409, 'CANNOT_BLOCK_ADMIN');
  });

  it('is a no-op for an already blocked user: keeps the original blocked_at', async () => {
    await expect(users.block(ENV, BLOCKED)).resolves.toBeDefined();
    expect((await row(BLOCKED)).blocked_at.toISOString()).toBe(BLOCKED_AT.toISOString());
  });

  it('unblocks a blocked user', async () => {
    await users.unblock(ENV, BLOCKED);
    expect((await row(BLOCKED)).blocked_at).toBeNull();
    expect(await users.isBlocked(BLOCKED)).toBe(false);
  });

  it('is a no-op to unblock a user who is not blocked', async () => {
    await expect(users.unblock(ENV, PLAIN)).resolves.toBeDefined();
    expect((await row(PLAIN)).blocked_at).toBeNull();
  });
});
