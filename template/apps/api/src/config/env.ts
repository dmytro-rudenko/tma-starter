import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

type RawEnv = Record<string, unknown>;

export class Env {
  @IsString()
  @IsNotEmpty()
  BOT_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  BOT_USERNAME!: string;

  @IsString()
  @IsNotEmpty()
  WEBAPP_URL!: string;

  @IsString()
  @IsNotEmpty()
  WEBHOOK_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  WEBHOOK_PATH_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3100;

  @IsOptional()
  @IsString()
  BOT_API_ROOT?: string;

  // Implicit conversion would turn the string 'false' into true, so read the raw value.
  @Transform(({ obj, key }) => {
    const raw = obj[key];
    if (typeof raw !== 'string') return raw;
    const value = raw.trim().toLowerCase();
    return value === 'true' ? true : value === 'false' ? false : raw;
  })
  @IsBoolean()
  RUN_WORKER: boolean = true;

  @IsInt()
  @Min(1)
  API_RATE_LIMIT: number = 120;

  @Transform(({ obj, key }) => {
    const raw = obj[key];
    if (typeof raw !== 'string') return raw;
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  })
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  ADMIN_USER_IDS: number[] = [];

  @IsInt()
  @Min(1)
  INIT_DATA_MAX_AGE_SEC: number = 86400;
}

const isUnset = (value: unknown): boolean => value === undefined || value === '';

export function validateEnv(config: RawEnv): Env {
  const present = Object.fromEntries(Object.entries(config).filter(([, v]) => !isUnset(v)));
  const env = plainToInstance(Env, present, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false, whitelist: false });
  if (errors.length > 0) {
    const missing = errors.filter((e) => isUnset(config[e.property])).map((e) => e.property);
    const invalid = errors
      .filter((e) => !isUnset(config[e.property]))
      .map((e) => `${e.property} (${Object.values(e.constraints ?? {}).join('; ')})`);
    const parts: string[] = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (invalid.length) parts.push(`invalid: ${invalid.join(', ')}`);
    throw new Error(`Invalid environment — ${parts.join(' | ')}`);
  }
  return env;
}
