import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { DocumentDeletionConflictError } from '../../domain/errors/document-deletion-conflict.error';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import {
  FILE_DELETION_OUTBOX,
  type FileDeletionOutboxPort,
} from '../../domain/ports/file-deletion-outbox.port';
import {
  LIBRARY_CONVERSIONS,
  type LibraryConversionsPort,
} from '../../domain/ports/library-conversions.port';
import {
  LIBRARY_DOCUMENTS,
  type LibraryDocumentsPort,
} from '../../domain/ports/library-documents.port';

/**
 * `DELETE /v1/documents/:id` (RF-25, ADR-0016). Dans **une** transaction :
 * propriété vérifiée d'abord (sinon un 409 révélerait le document d'un
 * autre), refus si une conversion travaille encore, puis suppression du
 * document (pages, conversions, positions en cascade) et inscription de ses
 * fichiers dans l'outbox. Les fichiers sont effacés par le balayage :
 * jamais de document à moitié détruit, jamais de fichier oublié.
 */
@Injectable()
export class DeleteDocumentUseCase {
  constructor(
    @Inject(LIBRARY_DOCUMENTS) private readonly documents: LibraryDocumentsPort,
    @Inject(LIBRARY_CONVERSIONS) private readonly conversions: LibraryConversionsPort,
    @Inject(FILE_DELETION_OUTBOX) private readonly outbox: FileDeletionOutboxPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  execute(input: {
    readonly ownerId: string;
    readonly documentId: string;
  }): Promise<Result<{ readonly fileCount: number }, DomainError>> {
    return this.uow.withTransaction(async (tx) => {
      const document = await this.documents.findForOwner(input.documentId, input.ownerId);
      if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));

      const cleanup = await this.conversions.cleanupForDocument(input.documentId, tx);
      if (cleanup.running) return Result.err(new DocumentDeletionConflictError(input.documentId));

      const deleted = await this.documents.deleteForOwner(input.documentId, input.ownerId, tx);
      // Supprimé entre-temps (requête rejouée en parallèle) : même réponse.
      if (deleted === null) return Result.err(new DocumentNotFoundError(input.documentId));

      const keys = deleted.sourceDeleted
        ? cleanup.fileKeys
        : [...cleanup.fileKeys, deleted.sourceKey];
      await this.outbox.add(keys, this.clock.now(), tx);
      return Result.ok({ fileCount: keys.length });
    });
  }
}
