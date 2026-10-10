import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { IdentityModule } from '../identity/identity.module';

import { DocumentCatalog } from './application/services/document-catalog.service';
import { DocumentTextReader } from './application/services/document-text-reader.service';
import { ConfirmDocumentUploadUseCase } from './application/use-cases/confirm-document-upload.use-case';
import { ExtractDocumentTextUseCase } from './application/use-cases/extract-document-text.use-case';
import { FailDocumentExtractionUseCase } from './application/use-cases/fail-document-extraction.use-case';
import { GetDocumentUseCase } from './application/use-cases/get-document.use-case';
import { ListDocumentPagesUseCase } from './application/use-cases/list-document-pages.use-case';
import { ListDocumentsUseCase } from './application/use-cases/list-documents.use-case';
import { PurgeAbandonedUploadsUseCase } from './application/use-cases/purge-abandoned-uploads.use-case';
import { RequestDocumentUploadUseCase } from './application/use-cases/request-document-upload.use-case';
import { RescheduleStalledExtractionsUseCase } from './application/use-cases/reschedule-stalled-extractions.use-case';
import { UpdateDocumentPageUseCase } from './application/use-cases/update-document-page.use-case';
import { DOCUMENT_UPLOAD_POLICY, type DocumentUploadPolicy } from './domain/document-upload-policy';
import { DOCUMENT_REPOSITORY } from './domain/ports/document-repository.port';
import { EXTRACTION_SCHEDULER } from './domain/ports/extraction-scheduler.port';
import { PDF_TEXT_EXTRACTOR } from './domain/ports/pdf-text-extractor.port';
import { buildDocumentUploadPolicy } from './infrastructure/config/document-upload-policy.factory';
import { PdfJsTextExtractor } from './infrastructure/extraction/pdfjs-text-extractor.adapter';
import { DrizzleDocumentRepository } from './infrastructure/persistence/document.drizzle-repository';
import { DocumentExtractionWorker } from './infrastructure/queue/document-extraction.worker';
import { QueueExtractionScheduler } from './infrastructure/queue/extraction-scheduler.adapter';
import { PurgeAbandonedUploadsJob } from './infrastructure/scheduling/purge-abandoned-uploads.job';
import { RescheduleStalledExtractionsJob } from './infrastructure/scheduling/reschedule-stalled-extractions.job';
import { DocumentPagesController } from './interface/http/document-pages.controller';
import { DocumentsController } from './interface/http/documents.controller';

/**
 * Module document (RF-01, RF-03, RF-06, RNF-24, ADR-0007, ADR-0009) : import
 * de PDF par upload direct pré-signé, extraction du texte par un worker
 * BullMQ, consultation et correction page par page, bibliothèque paginée. `OBJECT_STORAGE`,
 * `CURSOR_CODEC`, `CLOCK` et `DRIZZLE_CLIENT` viennent des modules globaux ;
 * `IdentityModule` fournit le `SessionGuard`. Exporte `DocumentTextReader`
 * (le texte, pour la conversion) et `DocumentCatalog` (la bibliothèque,
 * ADR-0015/0016) : seules portes d'entrée des autres modules.
 */
@Module({
  imports: [IdentityModule],
  controllers: [DocumentsController, DocumentPagesController],
  providers: [
    { provide: DOCUMENT_REPOSITORY, useClass: DrizzleDocumentRepository },
    { provide: PDF_TEXT_EXTRACTOR, useClass: PdfJsTextExtractor },
    { provide: EXTRACTION_SCHEDULER, useClass: QueueExtractionScheduler },
    {
      provide: DOCUMENT_UPLOAD_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DocumentUploadPolicy =>
        buildDocumentUploadPolicy(config),
    },
    RequestDocumentUploadUseCase,
    ConfirmDocumentUploadUseCase,
    GetDocumentUseCase,
    ListDocumentsUseCase,
    PurgeAbandonedUploadsUseCase,
    PurgeAbandonedUploadsJob,
    // Extraction du texte (ADR-0009)
    ExtractDocumentTextUseCase,
    FailDocumentExtractionUseCase,
    RescheduleStalledExtractionsUseCase,
    DocumentExtractionWorker,
    RescheduleStalledExtractionsJob,
    // Pages (RF-06)
    ListDocumentPagesUseCase,
    UpdateDocumentPageUseCase,
    // Lecture du texte pour la conversion (ADR-0010)
    DocumentTextReader,
    // Bibliothèque (ADR-0015, ADR-0016)
    DocumentCatalog,
  ],
  exports: [DocumentTextReader, DocumentCatalog],
})
export class DocumentModule {}
