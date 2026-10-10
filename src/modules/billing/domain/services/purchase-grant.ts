import { type Offer } from '../offer';
import { type Money } from '../value-objects/money.vo';
import { type Units } from '../value-objects/units.vo';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ce qu'un achat accorde, **recopié** de l'offre au moment du paiement
 * (ADR-0019 §7) : changer le catalogue ne modifie jamais un achat passé.
 */
export type PurchaseGrant =
  | {
      readonly kind: 'pass';
      readonly offerCode: string;
      readonly price: Money;
      readonly units: Units;
      readonly startsAt: Date;
      readonly endsAt: Date;
    }
  | {
      readonly kind: 'credits';
      readonly offerCode: string;
      readonly price: Money;
      readonly units: Units;
    };

/**
 * Traduit une offre achetée en droits (ADR-0019 §3). Un pass acheté pendant
 * un autre commence **à la fin** du dernier pass non terminé : aucun jour
 * perdu. `latestPassEnd` : fin du dernier pass de l'utilisateur (`null` si
 * aucun) — passée ou future, la règle prend le plus tard de `now` et d'elle.
 */
export function grantFor(offer: Offer, now: Date, latestPassEnd: Date | null): PurchaseGrant {
  if (offer.kind === 'credits') {
    return { kind: 'credits', offerCode: offer.code, price: offer.price, units: offer.units };
  }
  const startsAt =
    latestPassEnd !== null && latestPassEnd.getTime() > now.getTime() ? latestPassEnd : now;
  return {
    kind: 'pass',
    offerCode: offer.code,
    price: offer.price,
    units: offer.units,
    startsAt,
    endsAt: new Date(startsAt.getTime() + offer.durationDays * DAY_MS),
  };
}
