import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { buildQuotaPolicy } from './quota-policy.factory';

describe('buildQuotaPolicy', () => {
  it('reads the limits from the environment', () => {
    const values: Partial<Env> = { FREE_TIER_CHARS_PER_MONTH: 5, MAX_CHARS_PER_CONVERSION: 9 };
    const config = { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
    expect(buildQuotaPolicy(config)).toEqual({
      freeTierCharsPerMonth: 5,
      maxCharsPerConversion: 9,
    });
  });
});
