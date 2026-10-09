import { validateEnv } from './env.schema';

const POLLY = { TTS_PROVIDER: 'polly', AWS_REGION: 'eu-west-3' };

const BASE = {
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8080',
};

const S3 = {
  S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  S3_BUCKET: 'voxlivre',
  S3_ACCESS_KEY_ID: 'key-id',
  S3_SECRET_ACCESS_KEY: 'key-secret',
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

  it('refuses OTP log delivery in production unless explicitly allowed', () => {
    const prod = {
      ...BASE,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@h/db',
      REDIS_URL: 'redis://h',
      CURSOR_HMAC_SECRET: 'c'.repeat(32),
      ...S3,
      ...POLLY,
    };
    expect(() => validateEnv(prod)).toThrow(/OTP_DELIVERY_MODE/);
    expect(validateEnv({ ...prod, OTP_LOG_DELIVERY_UNSAFE_ALLOW: 'true' }).OTP_DELIVERY_MODE).toBe(
      'log',
    );
    expect(
      validateEnv({
        ...prod,
        OTP_DELIVERY_MODE: 'notification',
        OTP_EMAIL_FROM: 'noreply@voxlivre.test',
      }).OTP_DELIVERY_MODE,
    ).toBe('notification');
  });

  it('forces the auth rate-limit store to database in production', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@h/db',
        REDIS_URL: 'redis://h',
        CURSOR_HMAC_SECRET: 'c'.repeat(32),
        OTP_DELIVERY_MODE: 'notification',
        OTP_EMAIL_FROM: 'noreply@voxlivre.test',
        AUTH_RATE_LIMIT_STORAGE: 'memory',
      }),
    ).toThrow(/AUTH_RATE_LIMIT_STORAGE/);
  });

  it('applies OTP and session defaults', () => {
    const env = validateEnv({ ...BASE, DATABASE_URL: 'postgres://u:p@h/db' });
    expect(env.OTP_LENGTH).toBe(6);
    expect(env.OTP_EXPIRES_IN_SECONDS).toBe(300);
    expect(env.OTP_ALLOWED_ATTEMPTS).toBe(3);
    expect(env.SESSION_EXPIRES_IN_SECONDS).toBe(2_592_000);
  });

  it('rejects a short BETTER_AUTH_SECRET', () => {
    expect(() =>
      validateEnv({ ...BASE, BETTER_AUTH_SECRET: 'short', DATABASE_URL: 'postgres://u:p@h/db' }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('requires a bucket in production: native S3 (role) or another provider (keys)', () => {
    const prod = {
      ...BASE,
      ...POLLY,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@h/db',
      REDIS_URL: 'redis://h',
      CURSOR_HMAC_SECRET: 'c'.repeat(32),
      OTP_DELIVERY_MODE: 'notification',
      OTP_EMAIL_FROM: 'noreply@voxlivre.test',
    };
    expect(() => validateEnv(prod)).toThrow(/S3_BUCKET/);
    // S3 natif d'AWS : bucket seul, identifiants du rôle d'instance.
    const native = validateEnv({ ...prod, S3_BUCKET: 'voxlivre-prod' });
    expect(native.S3_BUCKET).toBe('voxlivre-prod');
    expect(native.S3_ACCESS_KEY_ID).toBeUndefined();
    // Autre fournisseur : endpoint + clés.
    expect(validateEnv({ ...prod, ...S3 }).S3_BUCKET).toBe('voxlivre');
  });

  it('wants both S3 keys or neither, and a region for native S3', () => {
    const dev = { ...BASE, DATABASE_URL: 'x' };
    expect(() => validateEnv({ ...dev, ...S3, S3_SECRET_ACCESS_KEY: '' })).toThrow(
      /S3_ACCESS_KEY_ID/,
    );
    expect(() => validateEnv({ ...dev, S3_BUCKET: 'b' })).toThrow(/AWS_REGION/);
    expect(validateEnv({ ...dev, S3_BUCKET: 'b', AWS_REGION: 'eu-west-3' }).S3_BUCKET).toBe('b');
  });

  it('needs a verified sender and a region to deliver OTPs by e-mail (SES)', () => {
    const dev = { ...BASE, DATABASE_URL: 'x', OTP_DELIVERY_MODE: 'notification' };
    expect(() => validateEnv(dev)).toThrow(/OTP_EMAIL_FROM[\s\S]*AWS_REGION/);
    expect(() =>
      validateEnv({ ...dev, AWS_REGION: 'eu-west-3', OTP_EMAIL_FROM: 'not-an-email' }),
    ).toThrow(/OTP_EMAIL_FROM/);
    expect(
      validateEnv({ ...dev, AWS_REGION: 'eu-west-3', OTP_EMAIL_FROM: 'noreply@voxlivre.test' })
        .OTP_EMAIL_FROM,
    ).toBe('noreply@voxlivre.test');
  });

  it('requires Polly in production, and a region whenever Polly is used', () => {
    const prod = {
      ...BASE,
      ...S3,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@h/db',
      REDIS_URL: 'redis://h',
      CURSOR_HMAC_SECRET: 'c'.repeat(32),
      OTP_DELIVERY_MODE: 'notification',
      OTP_EMAIL_FROM: 'noreply@voxlivre.test',
    };
    expect(() => validateEnv(prod)).toThrow(/TTS_PROVIDER/);
    expect(validateEnv({ ...prod, ...POLLY }).TTS_PROVIDER).toBe('polly');
    expect(() => validateEnv({ ...BASE, DATABASE_URL: 'x', TTS_PROVIDER: 'polly' })).toThrow(
      /AWS_REGION/,
    );
    expect(validateEnv({ ...BASE, DATABASE_URL: 'x' })).toMatchObject({ TTS_PROVIDER: 'fake' });
    expect(() => validateEnv({ ...BASE, DATABASE_URL: 'x', TTS_PROVIDER: 'google' })).toThrow(
      /TTS_PROVIDER/,
    );
  });

  it('applies storage and document defaults (storage optional outside production)', () => {
    const env = validateEnv({ ...BASE, DATABASE_URL: 'postgres://u:p@h/db' });
    expect(env.S3_BUCKET).toBeUndefined();
    expect(env.S3_REGION).toBe('auto');
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env.DOCUMENT_MAX_SIZE_BYTES).toBe(52_428_800);
    expect(env.JOB_WORKERS_ENABLED).toBe(true);
    expect(env.FREE_TIER_CHARS_PER_MONTH).toBe(100_000);
    expect(env.MAX_CHARS_PER_CONVERSION).toBe(1_000_000);
  });
});
