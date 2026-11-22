import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table payments add column refund_requested_by bigint null');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table payments drop column if exists refund_requested_by');
}
