import { Module } from '@nestjs/common';

import { ConversionModule } from '../conversion/conversion.module';
import { DocumentModule } from '../document/document.module';
import { LibraryModule } from '../library/library.module';
import { PaymentModule } from '../payment/payment.module';

import { DeleteAccountUseCase } from './application/use-cases/delete-account.use-case';
import { ACCOUNT_ACTIVITY } from './domain/ports/account-activity.port';
import { ACCOUNT_FILES } from './domain/ports/account-files.port';
import { USER_ACCOUNTS } from './domain/ports/user-accounts.port';
import { IdentityModule } from './identity.module';
import { ModulesAccountActivity } from './infrastructure/account/account-activity.adapter';
import { ModulesAccountFiles } from './infrastructure/account/account-files.adapter';
import { DrizzleUserAccounts } from './infrastructure/persistence/user-accounts.drizzle-repository';

/**
 * Suppression du compte (ADR-0023). Module à part : elle a besoin de
 * `document`, `conversion`, `payment` et `library`, qui importent tous
 * `IdentityModule` ; les importer depuis lui créerait un cycle.
 * `UNIT_OF_WORK`, `CLOCK` et `DRIZZLE_CLIENT` viennent des modules globaux.
 */
@Module({
  imports: [IdentityModule, DocumentModule, ConversionModule, PaymentModule, LibraryModule],
  providers: [
    { provide: USER_ACCOUNTS, useClass: DrizzleUserAccounts },
    { provide: ACCOUNT_ACTIVITY, useClass: ModulesAccountActivity },
    { provide: ACCOUNT_FILES, useClass: ModulesAccountFiles },
    DeleteAccountUseCase,
  ],
  exports: [DeleteAccountUseCase],
})
export class AccountDeletionModule {}
