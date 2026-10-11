import {
  type AccountActivityPort,
  type AccountDeletionBlocker,
} from '@/modules/identity/domain/ports/account-activity.port';
import { type AccountFilesPort } from '@/modules/identity/domain/ports/account-files.port';
import { type UserAccountsPort } from '@/modules/identity/domain/ports/user-accounts.port';

/** Utilisateurs en mémoire ; note dans quelle transaction chaque appel a eu lieu. */
export class InMemoryUserAccounts implements UserAccountsPort {
  readonly users = new Set<string>();
  readonly txSeen: unknown[] = [];

  lockForDeletion(userId: string, tx: unknown): Promise<boolean> {
    this.txSeen.push(tx);
    return Promise.resolve(this.users.has(userId));
  }

  delete(userId: string, tx: unknown): Promise<void> {
    this.txSeen.push(tx);
    this.users.delete(userId);
    return Promise.resolve();
  }
}

/** Blocage fixé par le test. */
export class StubAccountActivity implements AccountActivityPort {
  blocker: AccountDeletionBlocker | null = null;
  readonly txSeen: unknown[] = [];

  findBlocker(_userId: string, tx: unknown): Promise<AccountDeletionBlocker | null> {
    this.txSeen.push(tx);
    return Promise.resolve(this.blocker);
  }
}

/** Fichiers par utilisateur ; les clés « inscrites » s'accumulent dans `scheduled`. */
export class StubAccountFiles implements AccountFilesPort {
  readonly filesByUser = new Map<string, readonly string[]>();
  readonly scheduled: { readonly key: string; readonly at: Date; readonly tx: unknown }[] = [];

  scheduleDeletion(userId: string, requestedAt: Date, tx: unknown): Promise<number> {
    const keys = this.filesByUser.get(userId) ?? [];
    for (const key of keys) this.scheduled.push({ key, at: requestedAt, tx });
    return Promise.resolve(keys.length);
  }
}
