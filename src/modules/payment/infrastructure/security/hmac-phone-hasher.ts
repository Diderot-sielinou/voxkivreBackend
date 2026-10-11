import { createHmac } from 'node:crypto';

import { type PhoneHasherPort } from '../../domain/ports/phone-hasher.port';
import { type MobileMoneyNumber } from '../../domain/value-objects/mobile-money-number.vo';

/** Libellé de dérivation : une clé dédiée, distincte des autres usages du secret. */
const DERIVATION_LABEL = 'voxlivre:payment-phone-key:v1';

/**
 * Empreinte HMAC-SHA256 d'un numéro Mobile Money (ADR-0021 §11), clé
 * dérivée de `BETTER_AUTH_SECRET` comme pour les codes (ADR-0017), mais
 * avec son propre libellé : les deux journaux ne se recoupent pas.
 */
export class HmacPhoneHasher implements PhoneHasherPort {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHmac('sha256', secret).update(DERIVATION_LABEL).digest();
  }

  keyOf(phone: MobileMoneyNumber): string {
    return createHmac('sha256', this.key).update(phone).digest('hex');
  }
}
