import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { buildDocumentUploadPolicy } from './document-upload-policy.factory';

describe('buildDocumentUploadPolicy', () => {
  it('reads the size cap from the env and fixes the product durations', () => {
    const config = { get: () => 1234 } as unknown as ConfigService<Env, true>;
    expect(buildDocumentUploadPolicy(config)).toEqual({
      maxSizeBytes: 1234,
      uploadUrlTtlSeconds: 900,
      abandonedUploadTtlSeconds: 86_400,
    });
  });
});
