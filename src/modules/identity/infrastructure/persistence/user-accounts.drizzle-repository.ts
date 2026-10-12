import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type UserAccountsPort } from '../../domain/ports/user-accounts.port';

import { user } from './schema/auth.schema';

/** Suppression de la ligne `user` (ADR-0023) ; la cascade emporte ses données. */
@Injectable()
export class DrizzleUserAccounts implements UserAccountsPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findIdByContact(contact: string): Promise<string | null> {
    const column = contact.startsWith('+') ? user.phoneNumber : user.email;
    const rows = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(column, contact.startsWith('+') ? contact : contact.toLowerCase()))
      .limit(1);
    return rows.at(0)?.id ?? null;
  }

  /**
   * `FOR UPDATE` : une conversion ou un paiement créé en même temps vérifie
   * sa clé étrangère vers `user` et attend la fin de la suppression.
   */
  async lockForDeletion(userId: string, tx: unknown): Promise<boolean> {
    const rows = await this.client(tx)
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for('update');
    return rows.length > 0;
  }

  async delete(userId: string, tx: unknown): Promise<void> {
    await this.client(tx).delete(user).where(eq(user.id, userId));
  }

  /** Invariant : le `TxContext` opaque est toujours une transaction Drizzle. */
  private client(tx: unknown): DrizzleClient {
    return (tx as DrizzleClient | undefined) ?? this.db;
  }
}
