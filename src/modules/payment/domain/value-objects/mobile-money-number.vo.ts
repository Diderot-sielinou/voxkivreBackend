import { type Brand, Result } from '@/shared/kernel';

import { InvalidPaymentPhoneError } from '../errors/invalid-payment-phone.error';

/**
 * Numéro Mobile Money, toujours un **mobile camerounais** au format E.164
 * (`+2376` puis 8 chiffres), comme pour les SMS (ADR-0017, ADR-0021 §10).
 * Saisies acceptées : `+237 6…`, `237 6…` ou le numéro local `6…` (9
 * chiffres) ; espaces, points, tirets et parenthèses ignorés.
 */
export type MobileMoneyNumber = Brand<string, 'MobileMoneyNumber'>;

const CAMEROON_MOBILE = /^\+2376\d{8}$/;
const LOCAL_MOBILE = /^6\d{8}$/;
const SUFFIX_LENGTH = 2;

/** Complète l'indicatif d'une saisie locale (`6…`) ou sans `+` (`237…`). */
function toE164(compact: string): string {
  if (LOCAL_MOBILE.test(compact)) return `+237${compact}`;
  if (compact.startsWith('237')) return `+${compact}`;
  return compact;
}

export const MobileMoneyNumber = {
  of(raw: string): Result<MobileMoneyNumber, InvalidPaymentPhoneError> {
    const e164 = toE164(raw.replaceAll(/[\s().-]/g, ''));
    if (!CAMEROON_MOBILE.test(e164)) {
      return Result.err(
        new InvalidPaymentPhoneError(
          'Mobile Money number must be a Cameroonian mobile (e.g. +237699000000)',
        ),
      );
    }
    return Result.ok(e164 as MobileMoneyNumber);
  },

  /** Format attendu par les agrégateurs camerounais : sans `+` (`2376…`). */
  digits(phone: MobileMoneyNumber): string {
    return phone.slice(1);
  },

  /** Deux derniers chiffres : seule partie du numéro conservée en clair (§11). */
  suffix(phone: MobileMoneyNumber): string {
    return phone.slice(-SUFFIX_LENGTH);
  },
} as const;
