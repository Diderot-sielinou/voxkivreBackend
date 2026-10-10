import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { ListLibraryUseCase } from '@/modules/library/application/use-cases/list-library.use-case';

import { LibraryListResponseDto } from './dto/library-response.dto';
import { ListLibraryQueryDto } from './dto/list-library-query.dto';
import { toLibraryListResponseDto } from './mappers/library.mapper';

/**
 * Bibliothèque (RF-17, ADR-0015) : un élément par livre importé, avec sa
 * conversion, sa position et un statut (en cours, à reprendre, terminé…).
 * Le retéléchargement passe par le manifeste de la conversion (RF-18).
 */
@ApiTags('library')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'library', version: '1' })
@UseGuards(SessionGuard)
export class LibraryController {
  constructor(private readonly listLibrary: ListLibraryUseCase) {}

  @Get()
  @ApiOkResponse({ type: LibraryListResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CURSOR' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLibraryQueryDto,
  ): Promise<LibraryListResponseDto> {
    const result = await this.listLibrary.execute({
      ownerId: user.id,
      cursor: query.cursor,
      limit: query.limit,
    });
    if (result.isErr()) throw result.error;
    return toLibraryListResponseDto(result.value);
  }
}
