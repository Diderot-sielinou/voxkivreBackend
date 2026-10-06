import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { type QuotaPolicy } from '../../domain/quota-policy';

/** Limites du quota depuis l'env (ADR-0010). */
export function buildQuotaPolicy(config: ConfigService<Env, true>): QuotaPolicy {
  return {
    freeTierCharsPerMonth: config.get('FREE_TIER_CHARS_PER_MONTH', { infer: true }),
    maxCharsPerConversion: config.get('MAX_CHARS_PER_CONVERSION', { infer: true }),
  };
}
