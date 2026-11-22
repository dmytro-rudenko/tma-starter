import { Injectable } from '@nestjs/common';
import type { SettingDefinition } from './define-setting';

@Injectable()
export class AppSettingsRegistry {
  private readonly defs = new Map<string, SettingDefinition<unknown>>();

  register<T>(def: SettingDefinition<T>): void {
    if (this.defs.has(def.key)) throw new Error(`AppSettingsRegistry: duplicate key ${def.key}`);
    this.defs.set(def.key, def as SettingDefinition<unknown>);
  }

  find(key: string): SettingDefinition<unknown> | undefined {
    return this.defs.get(key);
  }

  all(): SettingDefinition<unknown>[] {
    return [...this.defs.values()];
  }
}
