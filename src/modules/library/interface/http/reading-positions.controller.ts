import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
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
import { GetReadingPositionUseCase } from '@/modules/library/application/use-cases/get-reading-position.use-case';
import { SaveReadingPositionUseCase } from '@/modules/library/application/use-cases/save-reading-position.use-case';

import {
  ReadingPositionResponseDto,
  SavedReadingPositionResponseDto,
} from './dto/reading-position-response.dto';
import { SaveReadingPositionDto } from './dto/save-reading-position.dto';
import { toReadingPositionDto, toSavedReadingPositionDto } from './mappers/library.mapper';

/**
 * Position de lecture d'une conversion (RF-19/20, ADR-0015) : le mobile
 * l'envoie à chaque pause ou interruption (et ~toutes les 30 s), et la
 * relit pour reprendre — sur n'importe quel appareil.
 */
@ApiTags('library')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'conversions/:id/position', version: '1' })
@UseGuards(SessionGuard)
export class ReadingPositionsController {
  constructor(
    private readonly savePosition: SaveReadingPositionUseCase,
    private readonly getPosition: GetReadingPositionUseCase,
  ) {}

  @Put()
  @ApiOkResponse({ type: SavedReadingPositionResponseDto })
  @ApiNotFoundResponse({ description: 'CONVERSION_NOT_FOUND' })
  @ApiConflictResponse({ description: "CONVERSION_NOT_READY : rien n'est encore écoutable" })
  @ApiUnprocessableEntityResponse({
    description:
      'INVALID_READING_POSITION (details.reason : word_out_of_range | audio_out_of_range | recorded_in_future)',
  })
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveReadingPositionDto,
  ): Promise<SavedReadingPositionResponseDto> {
    const result = await this.savePosition.execute({
      ownerId: user.id,
      conversionId: id,
      wordIndex: body.wordIndex,
      audioMs: body.audioMs,
      recordedAt: new Date(body.recordedAt),
    });
    if (result.isErr()) throw result.error;
    return toSavedReadingPositionDto(result.value);
  }

  @Get()
  @ApiOkResponse({ type: ReadingPositionResponseDto })
  @ApiNotFoundResponse({ description: 'READING_POSITION_NOT_FOUND : lecture jamais commencée' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReadingPositionResponseDto> {
    const result = await this.getPosition.execute({ ownerId: user.id, conversionId: id });
    if (result.isErr()) throw result.error;
    return toReadingPositionDto(result.value);
  }
}
