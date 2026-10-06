import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ConfirmDocumentUploadUseCase } from '@/modules/document/application/use-cases/confirm-document-upload.use-case';
import { GetDocumentUseCase } from '@/modules/document/application/use-cases/get-document.use-case';
import { ListDocumentsUseCase } from '@/modules/document/application/use-cases/list-documents.use-case';
import { RequestDocumentUploadUseCase } from '@/modules/document/application/use-cases/request-document-upload.use-case';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { OwnerId } from '@/modules/document/domain/value-objects/owner-id.vo';
import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';

import { DocumentPageResponseDto } from './dto/document-page-response.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentUploadResponseDto } from './dto/document-upload-response.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { RequestDocumentUploadDto } from './dto/request-document-upload.dto';
import {
  toDocumentPageResponseDto,
  toDocumentResponseDto,
  toDocumentUploadResponseDto,
} from './mappers/document.mapper';

const STORAGE_DOWN = 'Stockage objet indisponible ou non configuré (INFRASTRUCTURE_STORAGE_*)';

/**
 * Import de PDF en deux temps (ADR-0007) : `POST /v1/documents` renvoie une
 * URL signée, le mobile envoie le fichier directement au stockage, puis
 * confirme. Toutes les routes sont filtrées par propriétaire (RNF-08).
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
  @ApiOkResponse({ type: DocumentPageResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CURSOR' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentPageResponseDto> {
    const result = await this.listDocuments.execute({
      ownerId: OwnerId.of(user.id),
      cursor: query.cursor,
      limit: query.limit,
    });
    if (result.isErr()) throw result.error;
    return toDocumentPageResponseDto(result.value);
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
    return toDocumentResponseDto(result.value);
  }
}
