import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { IdentityModule } from '../identity/identity.module';

import { ConfirmDocumentUploadUseCase } from './application/use-cases/confirm-document-upload.use-case';
import { GetDocumentUseCase } from './application/use-cases/get-document.use-case';
import { ListDocumentsUseCase } from './application/use-cases/list-documents.use-case';
import { PurgeAbandonedUploadsUseCase } from './application/use-cases/purge-abandoned-uploads.use-case';
import { RequestDocumentUploadUseCase } from './application/use-cases/request-document-upload.use-case';
import { DOCUMENT_UPLOAD_POLICY, type DocumentUploadPolicy } from './domain/document-upload-policy';
import { DOCUMENT_REPOSITORY } from './domain/ports/document-repository.port';
import { buildDocumentUploadPolicy } from './infrastructure/config/document-upload-policy.factory';
import { DrizzleDocumentRepository } from './infrastructure/persistence/document.drizzle-repository';
import { PurgeAbandonedUploadsJob } from './infrastructure/scheduling/purge-abandoned-uploads.job';
import { DocumentsController } from './interface/http/documents.controller';

/**
 * Module document (RF-01, RNF-24, ADR-0007) : import de PDF par upload
 * direct pré-signé, consultation et bibliothèque paginée. `OBJECT_STORAGE`,
 * `CURSOR_CODEC`, `CLOCK` et `DRIZZLE_CLIENT` viennent des modules globaux ;
 * `IdentityModule` fournit le `SessionGuard`.
 */
@Module({
  imports: [IdentityModule],
  controllers: [DocumentsController],
  providers: [
    { provide: DOCUMENT_REPOSITORY, useClass: DrizzleDocumentRepository },
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
  ],
})
export class DocumentModule {}
