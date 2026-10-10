import { type Brand, Result } from '@/shared/kernel';

import { InvalidPhoneNumberError } from '../errors/invalid-phone-number.error';

/**
 * Numéro de téléphone au format E.164 (`+` puis 8 à 15 chiffres, premier
 * chiffre non nul). La connexion par SMS est en plus limitée aux mobiles
 * camerounais (`isCameroonMobile`, ADR-0017) : chaque SMS coûte, et ouvrir
 * l'international exposerait à la fraude au « SMS pumping ».
 */
export type PhoneNumber = Brand<string, 'PhoneNumber'>;

const E164 = /^\+[1-9]\d{7,14}$/;

/** Mobiles camerounais : +237 puis 9 chiffres commençant par 6 (plan de numérotation ART). */
const CAMEROON_MOBILE = /^\+2376\d{8}$/;

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

  /** Numéro valide ET mobile camerounais : seuls ceux-là reçoivent un SMS (ADR-0017). */
  isCameroonMobile(raw: string): boolean {
    const parsed = PhoneNumber.of(raw);
    return parsed.isOk() && CAMEROON_MOBILE.test(parsed.value);
  },
} as const;
