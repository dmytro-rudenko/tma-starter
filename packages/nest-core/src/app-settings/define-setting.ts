export interface SettingDefinition<T> {
  key: string;
  default: T;
  parse(v: unknown): T;
}

export function defineSetting<T>(def: SettingDefinition<T>): SettingDefinition<T> {
  return def;
}
