import { Controller, Delete, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { DeleteAccountUseCase } from '@/modules/identity/application/use-cases/delete-account.use-case';

import { CurrentUser } from './current-user.decorator';
import { type AuthenticatedUser, SessionGuard } from './session.guard';

/**
 * Suppression du compte (ADR-0023). Servi par `AccountDeletionModule` : le
 * `GET` du même chemin reste dans `MeController`. La confirmation explicite
 * est un dialogue du mobile ; ici, l'action est immédiate et définitive. Un
 * rejeu reçoit 401 : les sessions sont parties avec l'utilisateur.
 */
@ApiTags('identity')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide, expirée ou compte supprimé' })
@Controller({ path: 'me', version: '1' })
@UseGuards(SessionGuard)
export class AccountController {
  constructor(private readonly deleteAccount: DeleteAccountUseCase) {}

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description:
      'Compte, documents, conversions, pass et crédits supprimés ; fichiers effacés en arrière-plan (< 1 min). Paiements et achats gardés sans lien au compte.',
  })
  @ApiForbiddenResponse({
    description: 'RECENT_LOGIN_REQUIRED : session ouverte il y a plus de 10 min, se reconnecter',
  })
  @ApiConflictResponse({
    description:
      'ACCOUNT_DELETION_CONFLICT : `details.reason` = `conversion_in_progress` ou `payment_pending`',
  })
  async delete(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    const result = await this.deleteAccount.execute({
      userId: user.id,
      sessionCreatedAt: user.sessionCreatedAt,
    });
    if (result.isErr()) throw result.error;
  }
}
