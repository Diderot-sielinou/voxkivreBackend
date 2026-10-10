import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { DeleteDocumentUseCase } from '@/modules/library/application/use-cases/delete-document.use-case';

/**
 * Suppression d'un livre de la bibliothèque (RF-25, ADR-0016). La
 * confirmation explicite est un dialogue du mobile ; ici, l'action est
 * atomique et rejouable (404 la seconde fois).
 */
@ApiTags('documents')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'documents', version: '1' })
@UseGuards(SessionGuard)
export class LibraryDocumentsController {
  constructor(private readonly deleteDocument: DeleteDocumentUseCase) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description:
      'Document, texte, conversions et positions supprimés ; fichiers effacés en arrière-plan (< 1 min)',
  })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'DOCUMENT_DELETION_CONFLICT : une conversion est en cours' })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const result = await this.deleteDocument.execute({ ownerId: user.id, documentId: id });
    if (result.isErr()) throw result.error;
  }
}
