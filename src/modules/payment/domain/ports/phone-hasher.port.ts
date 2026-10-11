import { type MobileMoneyNumber } from '../value-objects/mobile-money-number.vo';

export const PHONE_HASHER = Symbol('PaymentPhoneHasher');

/**
 * Empreinte HMAC d'un numéro Mobile Money (ADR-0021 §11), pour le plafond
 * par numéro. Un simple hash ne suffit pas : un numéro camerounais se
 * retrouve par force brute.
 */
export interface PhoneHasherPort {
  keyOf(phone: MobileMoneyNumber): string;
}
