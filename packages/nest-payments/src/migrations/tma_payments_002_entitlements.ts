import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    create table entitlements (
      user_id bigint not null references users (id),
      product_id text not null,
      source text not null check (source in ('subscription', 'one_time', 'grant')),
      expires_at timestamptz null,
      subscription_charge_id text null,
      canceled_at timestamptz null,
      updated_at timestamptz not null default now(),
      primary key (user_id, product_id)
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('drop table if exists entitlements');
}
