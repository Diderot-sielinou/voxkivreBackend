import { Module } from '@nestjs/common';

import { ConversionModule } from '../conversion/conversion.module';
import { DocumentModule } from '../document/document.module';
import { IdentityModule } from '../identity/identity.module';

import { DeleteDocumentUseCase } from './application/use-cases/delete-document.use-case';
import { GetReadingPositionUseCase } from './application/use-cases/get-reading-position.use-case';
import { ListLibraryUseCase } from './application/use-cases/list-library.use-case';
import { PurgePendingFileDeletionsUseCase } from './application/use-cases/purge-pending-file-deletions.use-case';
import { SaveReadingPositionUseCase } from './application/use-cases/save-reading-position.use-case';
import { FILE_DELETION_OUTBOX } from './domain/ports/file-deletion-outbox.port';
import { LIBRARY_CONVERSIONS } from './domain/ports/library-conversions.port';
import { LIBRARY_DOCUMENTS } from './domain/ports/library-documents.port';
import { READING_POSITION_REPOSITORY } from './domain/ports/reading-position-repository.port';
import { ConversionModuleLibraryConversions } from './infrastructure/conversion/library-conversions.adapter';
import { DocumentModuleLibraryDocuments } from './infrastructure/document/library-documents.adapter';
import { DrizzleFileDeletionOutbox } from './infrastructure/persistence/file-deletion-outbox.drizzle-repository';
import { DrizzleReadingPositionRepository } from './infrastructure/persistence/reading-position.drizzle-repository';
import { PurgePendingFileDeletionsJob } from './infrastructure/scheduling/purge-pending-file-deletions.job';
import { LibraryDocumentsController } from './interface/http/library-documents.controller';
import { LibraryController } from './interface/http/library.controller';
import { ReadingPositionsController } from './interface/http/reading-positions.controller';

/**
 * Module library (RF-17 à RF-20, RF-25, ADR-0015, ADR-0016) : bibliothèque
 * composée à partir des modules document et conversion (chacun derrière un
 * port), position de lecture multi-appareils, suppression d'un document
 * avec effacement des fichiers par outbox. `OBJECT_STORAGE`, `CURSOR_CODEC`,
 * `UNIT_OF_WORK`, `CLOCK` et `DRIZZLE_CLIENT` viennent des modules globaux.
 */
@Module({
  imports: [IdentityModule, DocumentModule, ConversionModule],
  controllers: [LibraryController, ReadingPositionsController, LibraryDocumentsController],
  providers: [
    { provide: LIBRARY_DOCUMENTS, useClass: DocumentModuleLibraryDocuments },
    { provide: LIBRARY_CONVERSIONS, useClass: ConversionModuleLibraryConversions },
    { provide: READING_POSITION_REPOSITORY, useClass: DrizzleReadingPositionRepository },
    { provide: FILE_DELETION_OUTBOX, useClass: DrizzleFileDeletionOutbox },
    ListLibraryUseCase,
    SaveReadingPositionUseCase,
    GetReadingPositionUseCase,
    DeleteDocumentUseCase,
    PurgePendingFileDeletionsUseCase,
    PurgePendingFileDeletionsJob,
  ],
})
export class LibraryModule {}
