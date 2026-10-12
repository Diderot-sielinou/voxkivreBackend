import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';

import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { DeleteBookmarkUseCase } from '@/modules/library/application/use-cases/delete-bookmark.use-case';
import { ListBookmarksUseCase } from '@/modules/library/application/use-cases/list-bookmarks.use-case';
import { PutBookmarkUseCase } from '@/modules/library/application/use-cases/put-bookmark.use-case';
import { type BookmarkView } from '@/modules/library/domain/services/bookmark-anchor';

import {
  BookmarkListResponseDto,
  BookmarkResponseDto,
  DeleteBookmarkQueryDto,
  PutBookmarkDto,
} from './dto/bookmark.dto';

function toBookmarkDto(bookmark: BookmarkView): BookmarkResponseDto {
  return {
    id: bookmark.id,
    pageNumber: bookmark.pageNumber,
    wordIndex: bookmark.wordIndex,
    excerpt: bookmark.excerpt,
    note: bookmark.note,
    needsReview: bookmark.needsReview,
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: bookmark.updatedAt.toISOString(),
    deletedAt: bookmark.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Marque-pages d'un document (RF-27, ADR-0028). L'appareil crée
 * l'identifiant (hors ligne) et synchronise par `PUT` ; « le plus récent
 * gagne » par marque-page, suppressions comprises.
 */
@ApiTags('library')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'documents/:id/bookmarks', version: '1' })
@UseGuards(SessionGuard)
export class BookmarksController {
  constructor(
    private readonly putBookmark: PutBookmarkUseCase,
    private readonly listBookmarks: ListBookmarksUseCase,
    private readonly deleteBookmark: DeleteBookmarkUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: BookmarkListResponseDto })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'DOCUMENT_TEXT_NOT_READY' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookmarkListResponseDto> {
    const result = await this.listBookmarks.execute({ ownerId: user.id, documentId: id });
    if (result.isErr()) throw result.error;
    return { items: result.value.map((bookmark) => toBookmarkDto(bookmark)) };
  }

  @Put(':bookmarkId')
  @ApiCreatedResponse({ type: BookmarkResponseDto, description: 'Marque-page créé' })
  @ApiOkResponse({ type: BookmarkResponseDto, description: 'Note mise à jour, ou état retenu' })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'DOCUMENT_TEXT_NOT_READY | BOOKMARKS_LIMIT_CONFLICT | BOOKMARK_ID_CONFLICT',
  })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_BOOKMARK_NOTE | INVALID_BOOKMARK_ANCHOR | INVALID_BOOKMARK_TIMESTAMP',
  })
  async put(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bookmarkId', ParseUUIDPipe) bookmarkId: string,
    @Body() body: PutBookmarkDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookmarkResponseDto> {
    const result = await this.putBookmark.execute({
      ownerId: user.id,
      documentId: id,
      bookmarkId,
      pageNumber: body.pageNumber,
      wordIndex: body.wordIndex,
      note: body.note,
      updatedAt: new Date(body.updatedAt),
    });
    if (result.isErr()) throw result.error;
    response.status(result.value.created ? HttpStatus.CREATED : HttpStatus.OK);
    return toBookmarkDto(result.value.bookmark);
  }

  @Delete(':bookmarkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Trace de suppression gardée (idempotent)' })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_BOOKMARK_TIMESTAMP' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bookmarkId', ParseUUIDPipe) bookmarkId: string,
    @Query() query: DeleteBookmarkQueryDto,
  ): Promise<void> {
    const result = await this.deleteBookmark.execute({
      ownerId: user.id,
      documentId: id,
      bookmarkId,
      deletedAt: new Date(query.deletedAt),
    });
    if (result.isErr()) throw result.error;
  }
}
