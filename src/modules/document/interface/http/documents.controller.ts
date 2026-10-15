import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ConfirmDocumentUploadUseCase } from '@/modules/document/application/use-cases/confirm-document-upload.use-case';
import { GetDocumentOutlineUseCase } from '@/modules/document/application/use-cases/get-document-outline.use-case';
import { GetDocumentUseCase } from '@/modules/document/application/use-cases/get-document.use-case';
import { ListDocumentsUseCase } from '@/modules/document/application/use-cases/list-documents.use-case';
import { RenameDocumentUseCase } from '@/modules/document/application/use-cases/rename-document.use-case';
import { RequestDocumentUploadUseCase } from '@/modules/document/application/use-cases/request-document-upload.use-case';
import { ReviewDocumentUseCase } from '@/modules/document/application/use-cases/review-document.use-case';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { OwnerId } from '@/modules/document/domain/value-objects/owner-id.vo';
import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';

import { DocumentListResponseDto } from './dto/document-list-response.dto';
import { DocumentOutlineResponseDto } from './dto/document-outline-response.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentUploadResponseDto } from './dto/document-upload-response.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { RenameDocumentDto } from './dto/rename-document.dto';
import { RequestDocumentUploadDto } from './dto/request-document-upload.dto';
import {
  toDocumentListResponseDto,
  toDocumentResponseDto,
  toDocumentUploadResponseDto,
} from './mappers/document.mapper';

const STORAGE_DOWN = 'Stockage objet indisponible ou non configuré (INFRASTRUCTURE_STORAGE_*)';

/**
 * Import de PDF en deux temps (ADR-0007) : `POST /v1/documents` renvoie une
 * URL signée, le mobile envoie le fichier directement au stockage, puis
 * confirme. Toutes les routes sont filtrées par propriétaire (RNF-08).
 * La confirmation programme l'extraction du texte (ADR-0009) : le mobile
 * suit `status` (`uploaded` → `extracting` → `text_ready`) ; pour un scan,
 * `ocrProgress` pendant l'OCR, puis `reviewRequired` (ADR-0024).
 */
@ApiTags('documents')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'documents', version: '1' })
@UseGuards(SessionGuard)
export class DocumentsController {
  constructor(
    private readonly requestUpload: RequestDocumentUploadUseCase,
    private readonly confirmUpload: ConfirmDocumentUploadUseCase,
    private readonly getDocument: GetDocumentUseCase,
    private readonly listDocuments: ListDocumentsUseCase,
    private readonly reviewDocument: ReviewDocumentUseCase,
    private readonly getOutline: GetDocumentOutlineUseCase,
    private readonly renameDocument: RenameDocumentUseCase,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: DocumentUploadResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_DOCUMENT_TITLE | INVALID_DOCUMENT_SIZE | INVALID_RIGHTS_ATTESTATION',
  })
  @ApiServiceUnavailableResponse({ description: STORAGE_DOWN })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RequestDocumentUploadDto,
  ): Promise<DocumentUploadResponseDto> {
    const result = await this.requestUpload.execute({
      ownerId: OwnerId.of(user.id),
      title: body.title,
      sizeBytes: body.sizeBytes,
      rightsAttested: body.rightsAttested,
    });
    if (result.isErr()) throw result.error;
    return toDocumentUploadResponseDto(result.value);
  }

  @Post(':id/upload-confirmation')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_DOCUMENT_UPLOAD (details.reason : missing | size_mismatch | not_pdf)',
  })
  @ApiServiceUnavailableResponse({ description: STORAGE_DOWN })
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentResponseDto> {
    const result = await this.confirmUpload.execute({
      ownerId: OwnerId.of(user.id),
      documentId: DocumentId.of(id),
    });
    if (result.isErr()) throw result.error;
    return toDocumentResponseDto(result.value);
  }

  @Get()
  @ApiOkResponse({ type: DocumentListResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CURSOR' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentListResponseDto> {
    const result = await this.listDocuments.execute({
      ownerId: OwnerId.of(user.id),
      cursor: query.cursor,
      limit: query.limit,
    });
    if (result.isErr()) throw result.error;
    return toDocumentListResponseDto(result.value);
  }

  @Get(':id')
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentResponseDto> {
    const result = await this.getDocument.execute({
      ownerId: OwnerId.of(user.id),
      documentId: DocumentId.of(id),
    });
    if (result.isErr()) throw result.error;
    return toDocumentResponseDto(result.value.document, result.value.ocrPagesDone);
  }

  @Get(':id/outline')
  @ApiOkResponse({ type: DocumentOutlineResponseDto })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'DOCUMENT_TEXT_NOT_READY (details.status)' })
  async outline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentOutlineResponseDto> {
    const result = await this.getOutline.execute({
      ownerId: OwnerId.of(user.id),
      documentId: DocumentId.of(id),
    });
    if (result.isErr()) throw result.error;
    return {
      items: result.value.entries.map((entry) => ({
        title: entry.title,
        level: entry.level,
        pageNumber: entry.pageNumber,
      })),
      source: result.value.source,
    };
  }

  @Patch(':id')
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_DOCUMENT_TITLE' })
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameDocumentDto,
  ): Promise<DocumentResponseDto> {
    const result = await this.renameDocument.execute({
      ownerId: OwnerId.of(user.id),
      documentId: DocumentId.of(id),
      title: body.title,
    });
    if (result.isErr()) throw result.error;
    return toDocumentResponseDto(result.value);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'DOCUMENT_TEXT_NOT_READY (details.status)' })
  async review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentResponseDto> {
    const result = await this.reviewDocument.execute({
      ownerId: OwnerId.of(user.id),
      documentId: DocumentId.of(id),
    });
    if (result.isErr()) throw result.error;
    return toDocumentResponseDto(result.value);
  }
}
