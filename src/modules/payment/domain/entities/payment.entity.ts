import {
  type ConfirmationChannel,
  type PaymentFailureCode,
  type PaymentProvider,
  PaymentStatus,
} from '../value-objects/payment-status.vo';

/**
 * Une demande d'encaissement Mobile Money pour une offre (ADR-0021).
 * `userId` et `offerCode` viennent d'autres modules : de simples chaînes.
 * Le numéro n'est jamais conservé en clair (§11).
 */
export interface Payment {
  /** UUID v7 ; c'est aussi la référence de paiement transmise à `billing`. */
  readonly id: string;
  readonly userId: string;
  readonly offerCode: string;
  /** Prix **recopié** de l'offre à la création, en XAF. */
  readonly amountXaf: number;
  readonly idempotencyKey: string;
  /** Empreinte de la requête : même clé + requête différente → conflit. */
  readonly requestHash: string;
  readonly provider: PaymentProvider;
  /** Notre référence chez le prestataire (UUID v4) : rend la demande idempotente. */
  readonly externalReference: string;
  /** Référence du prestataire ; `null` tant qu'il n'a pas répondu (§8). */
  readonly providerReference: string | null;
  readonly phoneHmac: string;
  /** Deux derniers chiffres du numéro, pour l'affichage. */
  readonly phoneSuffix: string;
  readonly status: PaymentStatus;
  readonly confirmedVia: ConfirmationChannel | null;
  readonly failureCode: PaymentFailureCode | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export function newPendingPayment(input: {
  readonly id: string;
  readonly userId: string;
  readonly offerCode: string;
  readonly amountXaf: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly provider: PaymentProvider;
  readonly externalReference: string;
  readonly phoneHmac: string;
  readonly phoneSuffix: string;
  readonly now: Date;
}): Payment {
  const { now, ...target } = input;
  return {
    ...target,
    providerReference: null,
    status: PaymentStatus.PENDING,
    confirmedVia: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}
