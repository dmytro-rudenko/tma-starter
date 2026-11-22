import { knex as createKnex, Knex } from 'knex';

// pg returns bigint (oid 20) as a string; Telegram ids fit in a JS number.
const pgTypes = (
  require('pg') as { types: { setTypeParser(oid: number, parse: (v: string) => unknown): void } }
).types;
pgTypes.setTypeParser(20, (v: string) => Number(v));

export function createKnexConnection(databaseUrl: string): Knex {
  return createKnex({ client: 'pg', connection: databaseUrl, pool: { min: 0, max: 10 } });
}
