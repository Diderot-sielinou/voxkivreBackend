import { createHmac } from 'node:crypto';

import { type DestinationHasherPort } from '../../domain/ports/destination-hasher.port';

/** Libellé de dérivation : une clé dédiée, distincte des autres usages du secret. */
const DERIVATION_LABEL = 'voxlivre:otp-destination-key:v1';

/**
 * Empreinte HMAC-SHA256 d'une destination (ADR-0017 §4), clé dérivée de
 * `BETTER_AUTH_SECRET` (pas de nouveau secret à gérer). E-mail en
 * minuscules : `Alice@x.cm` et `alice@x.cm` sont la même boîte.
 */
export class HmacDestinationHasher implements DestinationHasherPort {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHmac('sha256', secret).update(DERIVATION_LABEL).digest();
  }

  keyOf(destination: string): string {
    const normalized = destination.includes('@') ? destination.toLowerCase() : destination;
    return createHmac('sha256', this.key).update(normalized).digest('hex');
  }
}
