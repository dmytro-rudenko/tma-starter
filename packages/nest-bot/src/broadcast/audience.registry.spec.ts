import { HttpException } from '@nestjs/common';
import { knex as createKnex, Knex } from 'knex';
import { BroadcastAudienceRegistry } from './audience.registry';

describe('BroadcastAudienceRegistry', () => {
  let knex: Knex;

  beforeAll(() => {
    knex = createKnex({ client: 'pg' });
  });

  afterAll(async () => {
    await knex.destroy();
  });

  const vip = {
    key: 'vip',
    label: 'VIP',
    apply: (qb: Knex.QueryBuilder, value: unknown) => qb.whereIn('users.id', value as number[]),
  };
  const paid = {
    key: 'paid',
    label: 'Paid',
    apply: (qb: Knex.QueryBuilder, value: unknown) =>
      value ? qb.whereNotNull('users.paid_at') : qb.whereNull('users.paid_at'),
  };

  it('lists registered filters as key and label in registration order', () => {
    const registry = new BroadcastAudienceRegistry();
    expect(registry.list()).toEqual([]);

    registry.register(vip);
    registry.register(paid);

    expect(registry.list()).toEqual([
      { key: 'vip', label: 'VIP' },
      { key: 'paid', label: 'Paid' },
    ]);
  });

  it('rejects a second registration under the same key', () => {
    const registry = new BroadcastAudienceRegistry();
    registry.register(vip);

    expect(() => registry.register({ ...vip, label: 'Other' })).toThrow(
      'Broadcast audience filter "vip" is already registered',
    );
    expect(registry.list()).toEqual([{ key: 'vip', label: 'VIP' }]);
  });

  it('adds each filter condition to the users query with its value', () => {
    const registry = new BroadcastAudienceRegistry();
    registry.register(vip);
    registry.register(paid);

    const qb = knex('users').select('users.id').whereNull('users.blocked_at');
    registry.apply(qb, { vip: [4002, 4003], paid: true });

    const sql = qb.toSQL().toNative();
    expect(sql.sql).toBe(
      'select "users"."id" from "users" where "users"."blocked_at" is null and "users"."id" in ($1, $2) and "users"."paid_at" is not null',
    );
    expect(sql.bindings).toEqual([4002, 4003]);
  });

  it('leaves the query unchanged for empty filters', () => {
    const registry = new BroadcastAudienceRegistry();
    registry.register(vip);

    const qb = knex('users').select('users.id');
    registry.apply(qb, {});

    expect(qb.toSQL().toNative().sql).toBe('select "users"."id" from "users"');
  });

  it('throws 400 VALIDATION for an unknown filter key and adds no condition', () => {
    const registry = new BroadcastAudienceRegistry();
    registry.register(vip);

    const qb = knex('users').select('users.id');
    let thrown: unknown;
    try {
      registry.apply(qb, { vip: [1], nope: 1 });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(400);
    expect((thrown as HttpException).getResponse()).toEqual({
      statusCode: 400,
      message: 'Unknown audience filter: nope',
      error: 'Bad Request',
      code: 'VALIDATION',
    });
    expect(qb.toSQL().toNative().sql).toBe('select "users"."id" from "users"');
  });
});
