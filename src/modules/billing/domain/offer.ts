import { type Money } from './value-objects/money.vo';
import { type Units } from './value-objects/units.vo';

/**
 * Offre du catalogue (ADR-0019), lue dans la table `offers` (remplie par
 * migration). Un pass donne des unités pendant `durationDays` jours ; des
 * crédits s'ajoutent au portefeuille sans expiration.
 */
interface OfferBase {
  /** Identifiant stable, référencé par les achats (ex. `pass-30d`, `credits-m`). */
  readonly code: string;
  readonly price: Money;
  readonly units: Units;
  /** Une offre retirée reste lisible (achats passés) mais ne se vend plus. */
  readonly active: boolean;
}

export interface PassOffer extends OfferBase {
  readonly kind: 'pass';
  readonly durationDays: number;
}

export interface CreditsOffer extends OfferBase {
  readonly kind: 'credits';
}

export type Offer = PassOffer | CreditsOffer;
