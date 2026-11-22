import { validateEnv } from '../src/config/env';

const REQUIRED = [
  'BOT_TOKEN',
  'BOT_USERNAME',
  'WEBAPP_URL',
  'WEBHOOK_SECRET',
  'WEBHOOK_PATH_TOKEN',
  'DATABASE_URL',
] as const;

const VALID: Record<string, string> = {
  BOT_TOKEN: '123456:env-test',
  BOT_USERNAME: 'env_test_bot',
  WEBAPP_URL: 'https://env.example.com',
  WEBHOOK_SECRET: 'env-secret-0123456789',
  WEBHOOK_PATH_TOKEN: 'env-path-token-0123',
  DATABASE_URL: 'postgres://postgres@127.0.0.1:54329/env_test',
};

function without(key: string): Record<string, string> {
  const env = { ...VALID };
  delete env[key];
  return env;
}

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected validateEnv to throw');
}

describe('validateEnv', () => {
  it('lists every missing required variable', () => {
    const message = errorOf(() => validateEnv({}));
    for (const key of REQUIRED) expect(message).toContain(key);
  });

  it.each(REQUIRED)('throws naming %s when only it is missing', (key) => {
    const message = errorOf(() => validateEnv(without(key)));
    expect(message).toContain(key);
    for (const other of REQUIRED.filter((k) => k !== key)) expect(message).not.toContain(other);
  });

  it.each(REQUIRED)('rejects an empty %s', (key) => {
    const message = errorOf(() => validateEnv({ ...VALID, [key]: '' }));
    expect(message).toContain(key);
  });

  it('applies defaults to the optional variables', () => {
    const env = validateEnv(VALID);
    expect(env.PORT).toBe(3100);
    expect(env.RUN_WORKER).toBe(true);
    expect(env.API_RATE_LIMIT).toBe(120);
    expect(env.INIT_DATA_MAX_AGE_SEC).toBe(86400);
    expect(env.ADMIN_USER_IDS).toEqual([]);
  });

  it('keeps the required values as given', () => {
    const env = validateEnv(VALID);
    for (const key of REQUIRED) expect(env[key]).toBe(VALID[key]);
  });

  it('converts numeric and boolean overrides', () => {
    const env = validateEnv({
      ...VALID,
      PORT: '3201',
      RUN_WORKER: 'false',
      API_RATE_LIMIT: '30',
      INIT_DATA_MAX_AGE_SEC: '600',
    });
    expect(env.PORT).toBe(3201);
    expect(env.RUN_WORKER).toBe(false);
    expect(env.API_RATE_LIMIT).toBe(30);
    expect(env.INIT_DATA_MAX_AGE_SEC).toBe(600);
  });

  it('parses ADMIN_USER_IDS into numbers', () => {
    expect(validateEnv({ ...VALID, ADMIN_USER_IDS: '1001, 2002,3003' }).ADMIN_USER_IDS).toEqual([
      1001, 2002, 3003,
    ]);
  });

  it('treats an empty ADMIN_USER_IDS as no admins', () => {
    expect(validateEnv({ ...VALID, ADMIN_USER_IDS: '' }).ADMIN_USER_IDS).toEqual([]);
  });

  it('rejects a non-numeric ADMIN_USER_IDS entry', () => {
    expect(errorOf(() => validateEnv({ ...VALID, ADMIN_USER_IDS: '1001,abc' }))).toContain(
      'ADMIN_USER_IDS',
    );
  });
});
