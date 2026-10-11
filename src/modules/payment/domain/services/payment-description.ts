import { type PayableOffer } from '../ports/billing.port';

/**
 * Libellé envoyé au prestataire avec la demande : le client peut le voir
 * dans son historique Mobile Money. Court, sans donnée personnelle, sans
 * accent (par prudence : on ignore l'encodage des messages opérateurs).
 */
export function paymentDescription(offer: PayableOffer): string {
  return offer.kind === 'pass'
    ? `Voxlivre - Pass ${String(offer.durationDays)} jours`
    : `Voxlivre - Credits ${String(offer.units)} unites`;
}
