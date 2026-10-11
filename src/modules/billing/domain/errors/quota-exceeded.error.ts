import { DomainError } from '@/shared/kernel';

import { type UnitsBySource } from '../services/allocation';
import { type VoiceTier } from '../value-objects/units.vo';

import { BILLING_ERROR_CODES } from './error-codes';

/**
 * Les sources de l'utilisateur ne couvrent pas la conversion (ADR-0019).
 * `details` dit au mobile ce que chaque source contient (`available`), ce
 * qui pouvait servir pour cette voix (`usable` : le gratuit ne finance pas
 * une voix naturelle) et ce qui était demandé (`requested`, en unités).
 */
export class QuotaExceededError extends DomainError {
  readonly code = BILLING_ERROR_CODES.QUOTA_EXCEEDED;

  constructor(details: {
    readonly requested: number;
    readonly usable: number;
    readonly tier: VoiceTier;
    readonly available: UnitsBySource;
    readonly period: string;
  }) {
    super(
      `Not enough units (${String(details.requested)} requested, ${String(details.usable)} usable)`,
      { details },
    );
  }
}
