import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    create table broadcasts (
      id uuid primary key default gen_random_uuid(),
      created_by bigint not null references users (id),
      text text not null,
      button jsonb null,
      audience jsonb not null default '{}',
      status text not null default 'queued' check (status in ('queued', 'running', 'done', 'canceled')),
      total int not null default 0,
      sent int not null default 0,
      failed int not null default 0,
      created_at timestamptz not null default now(),
      started_at timestamptz null,
      finished_at timestamptz null
    );
    create index broadcasts_status_created_at_idx on broadcasts (status, created_at);
    create table broadcast_deliveries (
      broadcast_id uuid not null references broadcasts (id) on delete cascade,
      user_id bigint not null references users (id) on delete cascade,
      status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
      attempts smallint not null default 0,
      error text null,
      sent_at timestamptz null,
      primary key (broadcast_id, user_id)
    );
    create index broadcast_deliveries_broadcast_id_status_idx on broadcast_deliveries (broadcast_id, status);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('drop table broadcast_deliveries; drop table broadcasts;');
}
