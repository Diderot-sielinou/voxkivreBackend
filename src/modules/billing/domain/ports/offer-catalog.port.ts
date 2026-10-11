import { type Offer } from '../offer';

export const OFFER_CATALOG = Symbol('OfferCatalog');

/** Catalogue des offres (table `offers`, remplie par migration — ADR-0019 §7). */
export interface OfferCatalogPort {
  /** Une offre retirée reste trouvable : un paiement lancé avant son retrait est honoré. */
  findByCode(code: string): Promise<Offer | null>;

  /** Offres en vente, pass d'abord puis crédits par prix croissant. */
  listActive(): Promise<readonly Offer[]>;
}
