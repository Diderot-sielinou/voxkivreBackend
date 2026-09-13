import { type Brand, Result } from '@/shared/kernel';

import { InvalidPhoneNumberError } from '../errors/invalid-phone-number.error';

/**
 * Numéro de téléphone au format E.164 (`+` puis 8 à 15 chiffres, premier
 * chiffre non nul). Pas de restriction pays : le ciblage Cameroun est un
 * choix produit, pas une contrainte technique (diaspora, tests).
 */
export type PhoneNumber = Brand<string, 'PhoneNumber'>;

const E164 = /^\+[1-9]\d{7,14}$/;

export const PhoneNumber = {
  of(raw: string): Result<PhoneNumber, InvalidPhoneNumberError> {
    const normalized = raw.replaceAll(/[\s().-]/g, '');
    if (!E164.test(normalized)) {
      return Result.err(
        new InvalidPhoneNumberError('Phone number must be E.164 (e.g. +237699000000)'),
      );
    }
    return Result.ok(normalized as PhoneNumber);
  },

  isValid(raw: string): boolean {
    return PhoneNumber.of(raw).isOk();
  },
} as const;
