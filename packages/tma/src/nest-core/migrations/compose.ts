import type { Knex } from 'knex';

interface ComposedEntry {
  source: Knex.MigrationSource<unknown>;
  migration: unknown;
}

export function composeMigrations(
  ...sources: Knex.MigrationSource<any>[]
): Knex.MigrationSource<ComposedEntry> {
  return {
    async getMigrations(loadExtensions) {
      const lists = await Promise.all(
        sources.map(async (source) =>
          (await source.getMigrations(loadExtensions)).map((migration) => ({ source, migration })),
        ),
      );
      return lists.flat();
    },
    getMigrationName: (entry) => entry.source.getMigrationName(entry.migration),
    getMigration: (entry) => entry.source.getMigration(entry.migration),
  };
}
