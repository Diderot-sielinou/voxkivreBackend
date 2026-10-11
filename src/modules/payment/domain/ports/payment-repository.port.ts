import { type Payment } from '../entities/payment.entity';
import { type AttemptWindows } from '../services/payment-policy';
import {
  type ConfirmationChannel,
  type PaymentFailureCode,
  type PaymentProvider,
  type PaymentStatus,
} from '../value-objects/payment-status.vo';

export const PAYMENT_REPOSITORY = Symbol('PaymentRepository');

/** Compteurs pour les plafonds (ADR-0021 §10), en une requête. */
export interface AttemptCounts {
  /** Paiement `pending` de l'utilisateur créé **après** `inFlightSince`, s'il y en a un. */
  readonly inFlightPaymentId: string | null;
  readonly userAttemptsLastHour: number;
  readonly phoneAttemptsLastDay: number;
}

/** Nouvel état d'un paiement qui quitte `pending` (ou `expired`, §5). */
export type PaymentCompletion =
  | { readonly status: typeof PaymentStatus.SUCCEEDED; readonly via: ConfirmationChannel }
  | {
      readonly status: typeof PaymentStatus.FAILED;
      /** `null` : refusé dès la demande (numéro), sans notification ni balayage. */
      readonly via: ConfirmationChannel | null;
      readonly failureCode: PaymentFailureCode;
    }
  | { readonly status: typeof PaymentStatus.AMOUNT_MISMATCH; readonly via: ConfirmationChannel }
  | {
      readonly status: typeof PaymentStatus.EXPIRED;
      readonly failureCode: PaymentFailureCode | null;
    };

/**
 * Persistance des paiements. `tx` : transaction ambiante transmise par le
 * use-case (`UnitOfWork`), opaque ici.
 */
export interface PaymentRepositoryPort {
  /** `false` si la clé d'idempotence de l'utilisateur existe déjà (course perdue). */
  insert(payment: Payment): Promise<boolean>;

  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Payment | null>;

  /** Filtre TOUJOURS sur l'utilisateur (RNF-08). */
  findByIdForUser(id: string, userId: string): Promise<Payment | null>;

  /** Sans filtre utilisateur : réservé aux notifications et au balayage. */
  findByProviderReference(provider: PaymentProvider, reference: string): Promise<Payment | null>;
  findByExternalReference(externalReference: string): Promise<Payment | null>;

  countAttempts(userId: string, phoneHmac: string, windows: AttemptWindows): Promise<AttemptCounts>;

  /** Pose la référence du prestataire si elle manque encore. `false` sinon. */
  attachProviderReference(id: string, reference: string, at: Date): Promise<boolean>;

  /**
   * **Conditionnel** : applique `completion` seulement si le statut actuel
   * est `from` (`WHERE status = from`). `false` si un autre chemin est
   * passé avant (notification et balayage simultanés).
   */
  complete(
    id: string,
    from: PaymentStatus,
    completion: PaymentCompletion,
    at: Date,
    tx?: unknown,
  ): Promise<boolean>;

  /** Paiements `pending` créés avant `createdBefore`, les plus anciens d'abord. */
  listPendingCreatedBefore(createdBefore: Date, limit: number): Promise<readonly Payment[]>;
}
