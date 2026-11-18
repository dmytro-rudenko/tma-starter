import type { Knex } from 'knex';

export interface TmaCoreOptions {
  knex: Knex;
  botToken: string;
  adminUserIds: number[];
  initDataMaxAgeSec?: number;
  auditRetentionDays?: number;
  runWorker: boolean;
  throttle?: { ttlMs: number; limit: number };
}

export interface ResolvedTmaCoreOptions {
  botToken: string;
  adminUserIds: number[];
  initDataMaxAgeSec: number;
  auditRetentionDays: number;
  runWorker: boolean;
  throttle: { ttlMs: number; limit: number };
}

export function resolveCoreOptions(opts: TmaCoreOptions): ResolvedTmaCoreOptions {
  return {
    botToken: opts.botToken,
    adminUserIds: opts.adminUserIds.map(Number),
    initDataMaxAgeSec: opts.initDataMaxAgeSec ?? 86400,
    auditRetentionDays: opts.auditRetentionDays ?? 90,
    runWorker: opts.runWorker,
    throttle: opts.throttle ?? { ttlMs: 60_000, limit: 120 },
  };
}

export function isEnvAdmin(opts: Pick<ResolvedTmaCoreOptions, 'adminUserIds'>, id: number): boolean {
  return opts.adminUserIds.includes(Number(id));
}
