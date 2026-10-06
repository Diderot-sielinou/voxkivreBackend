import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ListDocumentPagesUseCase } from '@/modules/document/application/use-cases/list-document-pages.use-case';
import { UpdateDocumentPageUseCase } from '@/modules/document/application/use-cases/update-document-page.use-case';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { OwnerId } from '@/modules/document/domain/value-objects/owner-id.vo';
import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';

import { DocumentPagesResponseDto, DocumentPageTextDto } from './dto/document-pages-response.dto';
import { ListDocumentPagesQueryDto } from './dto/list-document-pages-query.dto';
import { UpdateDocumentPageDto } from './dto/update-document-page.dto';
import { toDocumentPagesResponseDto, toDocumentPageTextDto } from './mappers/document.mapper';

const TEXT_NOT_READY = 'DOCUMENT_TEXT_NOT_READY : texte pas encore extrait ou extraction échouée';

/**
 * Texte extrait d'un document, page par page : consultation et correction
 * avant la synthèse vocale (RF-06, DEC-07). Disponible en `text_ready`.
 */
@ApiTags('documents')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND | DOCUMENT_PAGE_NOT_FOUND' })
@ApiConflictResponse({ description: TEXT_NOT_READY })
@Controller({ path: 'documents/:id/pages', version: '1' })
@UseGuards(SessionGuard)
export class DocumentPagesController {
  constructor(
    private readonly listPages: ListDocumentPagesUseCase,
    private readonly updatePage: UpdateDocumentPageUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: DocumentPagesResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CURSOR' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListDocumentPagesQueryDto,
  ): Promise<DocumentPagesResponseDto> {
    const result = await this.listPages.execute({
      ownerId: OwnerId.of(user.id),
      documentId: DocumentId.of(id),
      cursor: query.cursor,
      limit: query.limit,
    });
    if (result.isErr()) throw result.error;
    return toDocumentPagesResponseDto(result.value);
  }

  @Put(':pageNumber')
  @ApiOkResponse({ type: DocumentPageTextDto })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_PAGE_TEXT' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
    @Body() body: UpdateDocumentPageDto,
  ): Promise<DocumentPageTextDto> {
    const result = await this.updatePage.execute({
      ownerId: OwnerId.of(user.id),
      documentId: DocumentId.of(id),
      pageNumber,
      text: body.text,
    });
    if (result.isErr()) throw result.error;
    return toDocumentPageTextDto(result.value);
  }
}
