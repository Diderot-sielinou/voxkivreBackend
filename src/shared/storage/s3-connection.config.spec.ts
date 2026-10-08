import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { s3ConnectionFromEnv } from './s3-connection.config';

function config(values: Partial<Env>): ConfigService<Env, true> {
  const defaults: Partial<Env> = { S3_REGION: 'auto', S3_FORCE_PATH_STYLE: false };
  return {
    get: (key: keyof Env) => ({ ...defaults, ...values })[key],
  } as unknown as ConfigService<Env, true>;
}

describe('s3ConnectionFromEnv', () => {
  it('returns null without a bucket (storage not configured)', () => {
    expect(s3ConnectionFromEnv(config({}))).toBeNull();
  });

  it('targets native AWS S3 with the instance role when only the bucket is given', () => {
    expect(
      s3ConnectionFromEnv(config({ S3_BUCKET: 'voxlivre-prod', AWS_REGION: 'eu-west-3' })),
    ).toEqual({
      bucket: 'voxlivre-prod',
      region: 'eu-west-3',
      forcePathStyle: false,
    });
  });

  it('targets another provider with its endpoint and keys (RustFS, R2)', () => {
    expect(
      s3ConnectionFromEnv(
        config({
          S3_BUCKET: 'voxlivre-dev',
          S3_ENDPOINT: 'http://localhost:9002',
          S3_FORCE_PATH_STYLE: true,
          S3_ACCESS_KEY_ID: 'id',
          S3_SECRET_ACCESS_KEY: 'secret',
        }),
      ),
    ).toEqual({
      endpoint: 'http://localhost:9002',
      bucket: 'voxlivre-dev',
      region: 'auto',
      forcePathStyle: true,
      accessKeyId: 'id',
      secretAccessKey: 'secret',
    });
  });
});
