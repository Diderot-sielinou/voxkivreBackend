import { type DomainError, type Result } from '@/shared/kernel';

export const BILLING = Symbol('PaymentBilling');

/** Ce que `payment` doit savoir d'une offre pour la vendre. */
export type PayableOffer =
  | {
      readonly code: string;
      readonly kind: 'pass';
      readonly priceXaf: number;
      readonly units: number;
      readonly durationDays: number;
    }
  | {
      readonly code: string;
      readonly kind: 'credits';
      readonly priceXaf: number;
      readonly units: number;
    };

/**
 * Catalogue et accord des offres (ADR-0019 §9, ADR-0021 §6), implémenté
 * par un adapter vers `BillingModule`. `grant` rejoint la transaction en
 * cours de l'appelant (`UnitOfWork` réentrant).
 */
export interface BillingPort {
  /** Offre **en vente** (active), ou `null`. */
  findOffer(code: string): Promise<PayableOffer | null>;

  /** Accorde l'offre une seule fois par `paymentReference` (idempotent). */
  grant(input: {
    readonly paymentReference: string;
    readonly userId: string;
    readonly offerCode: string;
  }): Promise<Result<void, DomainError>>;
}
