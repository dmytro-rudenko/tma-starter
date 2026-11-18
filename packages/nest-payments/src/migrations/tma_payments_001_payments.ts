import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    create table payments (
      id uuid primary key default gen_random_uuid(),
      payer_id bigint not null references users (id),
      product_id text not null,
      target_id text null,
      amount_stars int not null,
      invoice_payload text not null,
      telegram_payment_charge_id text not null unique,
      is_recurring boolean not null default false,
      subscription_expires_at timestamptz null,
      status text not null check (status in ('paid', 'refund_pending', 'refunded')),
      settled_at timestamptz null,
      refunded_at timestamptz null,
      refund_attempts int not null default 0,
      refund_attempted_at timestamptz null,
      created_at timestamptz not null default now()
    )
  `);
  await knex.raw(
    'create unique index payments_invoice_payload_once_idx on payments (invoice_payload) where is_recurring = false',
  );
  await knex.raw(
    "create index payments_refund_pending_idx on payments (created_at) where status = 'refund_pending'",
  );
  await knex.raw('create index payments_payer_created_idx on payments (payer_id, created_at desc)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('drop table if exists payments');
}
