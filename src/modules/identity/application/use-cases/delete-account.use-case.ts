import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { AccountDeletionConflictError } from '../../domain/errors/account-deletion-conflict.error';
import { RecentLoginRequiredError } from '../../domain/errors/recent-login-required.error';
import { UserNotFoundError } from '../../domain/errors/user-not-found.error';
import {
  ACCOUNT_ACTIVITY,
  type AccountActivityPort,
} from '../../domain/ports/account-activity.port';
import { ACCOUNT_FILES, type AccountFilesPort } from '../../domain/ports/account-files.port';
import { USER_ACCOUNTS, type UserAccountsPort } from '../../domain/ports/user-accounts.port';
import { isRecentLogin, RECENT_LOGIN_MAX_AGE_MS } from '../../domain/services/recent-login';

/**
 * Qui demande : l'utilisateur depuis l'app (reconnexion récente exigée), ou
 * l'opérateur pour une demande reçue par e-mail, identité vérifiée hors
 * ligne (`pnpm account:delete`, ADR-0023).
 */
export type DeleteAccountInput =
  | {
      readonly userId: string;
      readonly requestedBy: 'user';
      /** Ouverture de la session qui demande la suppression. */
      readonly sessionCreatedAt: Date;
    }
  | { readonly userId: string; readonly requestedBy: 'operator' };

/**
 * `DELETE /v1/me` (ADR-0023). Refus si la session n'est pas récente ; puis,
 * dans **une** transaction : verrou sur l'utilisateur (rien ne s'y rattache
 * plus), refus si un travail est en cours, fichiers inscrits dans l'outbox,
 * suppression de l'utilisateur (le reste suit en cascade ; paiements et
 * achats sont détachés et gardés). Jamais de compte à moitié détruit.
 */
@Injectable()
export class DeleteAccountUseCase {
  private readonly logger = new Logger(DeleteAccountUseCase.name);

  constructor(
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccountsPort,
    @Inject(ACCOUNT_ACTIVITY) private readonly activity: AccountActivityPort,
    @Inject(ACCOUNT_FILES) private readonly files: AccountFilesPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(
    input: DeleteAccountInput,
  ): Promise<Result<{ readonly fileCount: number }, DomainError>> {
    const now = this.clock.now();
    if (input.requestedBy === 'user' && !isRecentLogin(input.sessionCreatedAt, now)) {
      return Result.err(new RecentLoginRequiredError(RECENT_LOGIN_MAX_AGE_MS / 1000));
    }

    const result = await this.uow.withTransaction(async (tx) => {
      if (!(await this.accounts.lockForDeletion(input.userId, tx))) {
        return Result.err(new UserNotFoundError(input.userId));
      }
      const blocker = await this.activity.findBlocker(input.userId, tx);
      if (blocker !== null) return Result.err(new AccountDeletionConflictError(blocker));

      const fileCount = await this.files.scheduleDeletion(input.userId, now, tx);
      await this.accounts.delete(input.userId, tx);
      return Result.ok({ fileCount });
    });

    if (result.isOk()) {
      this.logger.log(
        { userId: input.userId, requestedBy: input.requestedBy, fileCount: result.value.fileCount },
        'account.deleted',
      );
    }
    return result;
  }
}
