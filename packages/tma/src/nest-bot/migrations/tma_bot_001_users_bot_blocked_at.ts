import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table users add column bot_blocked_at timestamptz null');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table users drop column bot_blocked_at');
}
