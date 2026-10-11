import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gt, gte, isNull, lt, or, sql } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type Payment } from '../../domain/entities/payment.entity';
import {
  type AttemptCounts,
  type PaymentCompletion,
  type PaymentRepositoryPort,
} from '../../domain/ports/payment-repository.port';
import { type AttemptWindows } from '../../domain/services/payment-policy';
import {
  type ConfirmationChannel,
  type PaymentFailureCode,
  type PaymentProvider,
  PaymentStatus,
} from '../../domain/value-objects/payment-status.vo';

import { payments } from './schema/payment.schema';

/** Colonnes nommées une à une dans le SQL émis (jamais `SELECT *`). */
const COLUMNS = getTableColumns(payments);

type PaymentRow = typeof payments.$inferSelect;

/** Paiements en SQL (ADR-0021). Toute transition est conditionnelle (§5). */
@Injectable()
export class DrizzlePaymentRepository implements PaymentRepositoryPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async insert(payment: Payment): Promise<boolean> {
    const inserted = await this.db
      .insert(payments)
      .values(payment)
      .onConflictDoNothing({ target: [payments.userId, payments.idempotencyKey] })
      .returning({ id: payments.id });
    return inserted.length > 0;
  }

  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Payment | null> {
    return this.findOne(
      and(eq(payments.userId, userId), eq(payments.idempotencyKey, idempotencyKey)),
    );
  }

  findByIdForUser(id: string, userId: string): Promise<Payment | null> {
    return this.findOne(and(eq(payments.id, id), eq(payments.userId, userId)));
  }

  findByProviderReference(provider: PaymentProvider, reference: string): Promise<Payment | null> {
    return this.findOne(
      and(eq(payments.provider, provider), eq(payments.providerReference, reference)),
    );
  }

  findByExternalReference(externalReference: string): Promise<Payment | null> {
    return this.findOne(eq(payments.externalReference, externalReference));
  }

  /**
   * Une seule lecture, bornée par les index `(user_id, created_at)` et
   * `(phone_hmac, created_at)` : la fenêtre « en cours » (15 min) est
   * incluse dans celle de l'utilisateur (1 h).
   */
  async countAttempts(
    userId: string,
    phoneHmac: string,
    windows: AttemptWindows,
  ): Promise<AttemptCounts> {
    const ofUser = and(eq(payments.userId, userId), gte(payments.createdAt, windows.userSince));
    const ofPhone = and(
      eq(payments.phoneHmac, phoneHmac),
      gte(payments.createdAt, windows.phoneSince),
    );
    const inFlight = and(
      eq(payments.userId, userId),
      eq(payments.status, PaymentStatus.PENDING),
      // « De moins de 15 min » : borne exclue.
      gt(payments.createdAt, windows.inFlightSince),
    );
    const rows = await this.db
      .select({
        inFlightPaymentId: sql<
          string | null
        >`(array_agg(${payments.id} order by ${payments.createdAt} desc) filter (where ${inFlight}))[1]`,
        userAttemptsLastHour: sql<number>`count(*) filter (where ${ofUser})`.mapWith(Number),
        phoneAttemptsLastDay: sql<number>`count(*) filter (where ${ofPhone})`.mapWith(Number),
      })
      .from(payments)
      .where(or(ofUser, ofPhone));
    const row = rows.at(0);
    return {
      inFlightPaymentId: row?.inFlightPaymentId ?? null,
      userAttemptsLastHour: row?.userAttemptsLastHour ?? 0,
      phoneAttemptsLastDay: row?.phoneAttemptsLastDay ?? 0,
    };
  }

  async attachProviderReference(id: string, reference: string, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(payments)
      .set({ providerReference: reference, updatedAt: at })
      .where(and(eq(payments.id, id), isNull(payments.providerReference)))
      .returning({ id: payments.id });
    return updated.length > 0;
  }

  async complete(
    id: string,
    from: PaymentStatus,
    completion: PaymentCompletion,
    at: Date,
    tx?: unknown,
  ): Promise<boolean> {
    const updated = await this.client(tx)
      .update(payments)
      .set({
        status: completion.status,
        confirmedVia: 'via' in completion ? completion.via : null,
        failureCode: 'failureCode' in completion ? completion.failureCode : null,
        completedAt: at,
        updatedAt: at,
      })
      .where(and(eq(payments.id, id), eq(payments.status, from)))
      .returning({ id: payments.id });
    return updated.length > 0;
  }

  async listPendingCreatedBefore(createdBefore: Date, limit: number): Promise<readonly Payment[]> {
    const rows = await this.db
      .select(COLUMNS)
      .from(payments)
      .where(and(eq(payments.status, PaymentStatus.PENDING), lt(payments.createdAt, createdBefore)))
      .orderBy(asc(payments.createdAt))
      .limit(limit);
    return rows.map((row) => toPayment(row));
  }

  private async findOne(where: ReturnType<typeof and>): Promise<Payment | null> {
    const rows = await this.db.select(COLUMNS).from(payments).where(where).limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toPayment(row);
  }

  /** Invariant : le `TxContext` opaque est toujours une transaction Drizzle. */
  private client(tx?: unknown): DrizzleClient {
    return (tx as DrizzleClient | undefined) ?? this.db;
  }
}

/** Les `CHECK` de la table garantissent les valeurs des colonnes énumérées. */
function toPayment(row: PaymentRow): Payment {
  return {
    ...row,
    provider: row.provider as PaymentProvider,
    status: row.status as PaymentStatus,
    confirmedVia: row.confirmedVia as ConfirmationChannel | null,
    failureCode: row.failureCode as PaymentFailureCode | null,
  };
}
