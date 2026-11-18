import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Knex } from 'knex';
import { AuditService } from '../audit/audit.service';
import { apiError } from '../common/api-error';
import { TMA_KNEX } from '../tokens';
import type { SettingDefinition } from './define-setting';
import { AppSettingsRegistry } from './registry';

export const APP_SETTINGS_CLOCK = Symbol('APP_SETTINGS_CLOCK');
export const APP_SETTINGS_CACHE_MS = 30_000;

export interface AppSettingView {
  key: string;
  value: unknown;
  default: unknown;
}

@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);
  private cache?: { rows: Map<string, unknown>; at: number };

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly registry: AppSettingsRegistry,
    private readonly audit: AuditService,
    @Inject(APP_SETTINGS_CLOCK) private readonly clock: () => number,
  ) {}

  async get<T>(key: string): Promise<T> {
    const def = this.definition(key);
    return this.effective(def, await this.rows()) as T;
  }

  async list(): Promise<AppSettingView[]> {
    const rows = await this.rows();
    return this.registry
      .all()
      .map((def) => ({ key: def.key, value: this.effective(def, rows), default: def.default }));
  }

  async set(actorId: number, key: string, value: unknown): Promise<unknown> {
    const def = this.definition(key);
    let parsed: unknown;
    try {
      parsed = def.parse(value);
    } catch (err) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', err instanceof Error ? err.message : String(err));
    }
    if (parsed === undefined) throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION');
    try {
      await this.knex.transaction(async (trx) => {
        const row = await trx('app_settings').where({ key }).forUpdate().first('value');
        const from = row ? row.value : def.default;
        await trx('app_settings')
          .insert({ key, value: JSON.stringify(parsed), updated_at: trx.fn.now() })
          .onConflict('key')
          .merge(['value', 'updated_at']);
        await this.audit.record(trx, {
          actorId,
          action: 'settings.update',
          targetType: 'setting',
          targetId: key,
          meta: { from, to: parsed },
        });
      });
    } finally {
      this.cache = undefined;
    }
    return parsed;
  }

  private definition(key: string): SettingDefinition<unknown> {
    const def = this.registry.find(key);
    if (!def) throw apiError(HttpStatus.BAD_REQUEST, 'UNKNOWN_SETTING', `Unknown setting ${key}`);
    return def;
  }

  private async rows(): Promise<Map<string, unknown>> {
    const now = this.clock();
    if (this.cache && now - this.cache.at < APP_SETTINGS_CACHE_MS) return this.cache.rows;
    const rows: { key: string; value: unknown }[] = await this.knex('app_settings').select('key', 'value');
    const map = new Map(rows.map((r) => [r.key, r.value]));
    this.cache = { rows: map, at: now };
    return map;
  }

  private effective(def: SettingDefinition<unknown>, rows: Map<string, unknown>): unknown {
    if (!rows.has(def.key)) return def.default;
    try {
      return def.parse(rows.get(def.key));
    } catch (err) {
      this.logger.warn(`stored ${def.key} rejected by parse, using default: ${String(err)}`);
      return def.default;
    }
  }
}
