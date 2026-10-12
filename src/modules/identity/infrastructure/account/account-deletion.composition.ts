import { ConversionCatalog } from '@/modules/conversion/application/services/conversion-catalog.service';
import { DrizzleConversionRepository } from '@/modules/conversion/infrastructure/persistence/conversion.drizzle-repository';
import { DocumentCatalog } from '@/modules/document/application/services/document-catalog.service';
import { DrizzleDocumentRepository } from '@/modules/document/infrastructure/persistence/document.drizzle-repository';
import { FileDeletionScheduler } from '@/modules/library/application/services/file-deletion-scheduler.service';
import { DrizzleFileDeletionOutbox } from '@/modules/library/infrastructure/persistence/file-deletion-outbox.drizzle-repository';
import { PaymentActivity } from '@/modules/payment/application/services/payment-activity.service';
import { DrizzlePaymentRepository } from '@/modules/payment/infrastructure/persistence/payment.drizzle-repository';
import { type ClockPort } from '@/shared/kernel';
import { type DrizzleClient } from '@/shared/persistence';
import { DrizzleUnitOfWork } from '@/shared/persistence/drizzle-unit-of-work';

import { DeleteAccountUseCase } from '../../application/use-cases/delete-account.use-case';
import { DrizzleUserAccounts } from '../persistence/user-accounts.drizzle-repository';

import { ModulesAccountActivity } from './account-activity.adapter';
import { ModulesAccountFiles } from './account-files.adapter';

/**
 * Le câblage d'`AccountDeletionModule`, sans Nest : pour le script ops
 * (`pnpm account:delete`), qui ne doit démarrer ni Redis, ni workers, ni
 * crons. Mêmes classes que le module ; à garder alignés.
 */
export function composeAccountDeletion(db: DrizzleClient, clock: ClockPort) {
  const accounts = new DrizzleUserAccounts(db);
  const conversions = new ConversionCatalog(new DrizzleConversionRepository(db));
  const activity = new ModulesAccountActivity(
    conversions,
    new PaymentActivity(new DrizzlePaymentRepository(db)),
  );
  const files = new ModulesAccountFiles(
    new DocumentCatalog(new DrizzleDocumentRepository(db)),
    conversions,
    new FileDeletionScheduler(new DrizzleFileDeletionOutbox(db)),
  );
  const deleteAccount = new DeleteAccountUseCase(
    accounts,
    activity,
    files,
    new DrizzleUnitOfWork(db),
    clock,
  );
  return { accounts, activity, deleteAccount };
}
