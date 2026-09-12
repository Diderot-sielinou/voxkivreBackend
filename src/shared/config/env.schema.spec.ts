import { validateEnv } from './env.schema';

const BASE = {
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8080',
};

describe('validateEnv', () => {
  it('accepts DATABASE_URL alone', () => {
    const env = validateEnv({ ...BASE, DATABASE_URL: 'postgres://u:p@h:5432/db' });
    expect(env.DATABASE_URL).toBe('postgres://u:p@h:5432/db');
    expect(env.PORT).toBe(8080);
  });

  it('accepts DB_* components alone', () => {
    const env = validateEnv({ ...BASE, DB_HOST: 'localhost', DB_NAME: 'vox', DB_USER: 'vox' });
    expect(env.DB_PORT).toBe(5432);
  });

  it('rejects when neither DATABASE_URL nor DB_* are provided', () => {
    expect(() => validateEnv(BASE)).toThrow(/DATABASE_URL/);
  });

  it('treats an empty DATABASE_URL as absent', () => {
    expect(() => validateEnv({ ...BASE, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('parses CORS_ALLOWED_ORIGINS into a trimmed list', () => {
    const env = validateEnv({
      ...BASE,
      DATABASE_URL: 'postgres://u:p@h/db',
      CORS_ALLOWED_ORIGINS: ' https://a.com, https://b.com ,',
    });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('coerces booleans from "true"/"false" strings only', () => {
    const env = validateEnv({ ...BASE, DATABASE_URL: 'postgres://u:p@h/db', DB_SSL: 'true' });
    expect(env.DB_SSL).toBe(true);
    expect(() =>
      validateEnv({ ...BASE, DATABASE_URL: 'postgres://u:p@h/db', DB_SSL: 'yes' }),
    ).toThrow(/DB_SSL/);
  });

  it('requires Redis and cursor secret in production', () => {
    expect(() =>
      validateEnv({ ...BASE, NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/db' }),
    ).toThrow(/REDIS_URL[\s\S]*CURSOR_HMAC_SECRET/);
  });

  it('rejects a short BETTER_AUTH_SECRET', () => {
    expect(() =>
      validateEnv({ ...BASE, BETTER_AUTH_SECRET: 'short', DATABASE_URL: 'postgres://u:p@h/db' }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });
});
