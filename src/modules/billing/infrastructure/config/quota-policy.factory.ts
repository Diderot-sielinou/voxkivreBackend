import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { type QuotaPolicy } from '../../domain/quota-policy';

/** Limites du quota depuis l'env (ADR-0010, ADR-0019). */
export function buildQuotaPolicy(config: ConfigService<Env, true>): QuotaPolicy {
  return {
    freeTierUnitsPerMonth: config.get('FREE_TIER_UNITS_PER_MONTH', { infer: true }),
    maxCharsPerConversion: config.get('MAX_CHARS_PER_CONVERSION', { infer: true }),
  };
}
