import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    create table users (
      id bigint primary key,
      first_name text not null,
      username text null,
      photo_url text null,
      language_code text null,
      language text null check (language in ('uk', 'en')),
      theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
      blocked_at timestamptz null,
      admin_granted_at timestamptz null,
      admin_granted_by bigint null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await knex.raw('create index users_created_at_id_idx on users (created_at desc, id desc)');
  await knex.raw('create index users_lower_username_idx on users (lower(username))');

  await knex.raw(`
    create table audit_events (
      id bigserial primary key,
      at timestamptz not null default now(),
      actor_id bigint null,
      action text not null,
      target_type text null,
      target_id text null,
      meta jsonb null
    )
  `);
  await knex.raw('create index audit_events_at_idx on audit_events (at desc)');
  await knex.raw(
    'create index audit_events_target_idx on audit_events (target_type, target_id, at desc)',
  );
  await knex.raw('create index audit_events_actor_idx on audit_events (actor_id, at desc)');

  await knex.raw(`
    create table app_settings (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('drop table if exists app_settings');
  await knex.raw('drop table if exists audit_events');
  await knex.raw('drop table if exists users');
}
