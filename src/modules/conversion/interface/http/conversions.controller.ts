import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPaymentRequiredResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { GetConversionUseCase } from '@/modules/conversion/application/use-cases/get-conversion.use-case';
import { StartConversionUseCase } from '@/modules/conversion/application/use-cases/start-conversion.use-case';
import { ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';

import { ConversionResponseDto } from './dto/conversion-response.dto';
import { StartConversionDto } from './dto/start-conversion.dto';
import { toConversionProgressDto, toConversionResponseDto } from './mappers/conversion.mapper';

/**
 * Conversion du texte d'un document en audio synchronisé (RF-08) : le
 * lancement réserve le quota (ADR-0010) et met la préparation en file ; le
 * mobile suit ensuite `status` et `progress` (polling).
 */
@ApiTags('conversions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ version: '1' })
@UseGuards(SessionGuard)
export class ConversionsController {
  constructor(
    private readonly startConversion: StartConversionUseCase,
    private readonly getConversion: GetConversionUseCase,
  ) {}

  @Post('documents/:id/conversions')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    type: ConversionResponseDto,
    description:
      'Conversion lancée, ou conversion existante pour ce texte et cette voix (sans nouveau débit)',
  })
  @ApiNotFoundResponse({ description: 'DOCUMENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'DOCUMENT_TEXT_NOT_READY' })
  @ApiPaymentRequiredResponse({ description: 'QUOTA_EXCEEDED (details.remaining)' })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_VOICE | INVALID_CONVERSION_TEXT | QUOTA_CONVERSION_LIMIT_EXCEEDED',
  })
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() body: StartConversionDto,
  ): Promise<ConversionResponseDto> {
    const result = await this.startConversion.execute({
      ownerId: user.id,
      documentId,
      voiceId: body.voiceId,
    });
    if (result.isErr()) throw result.error;
    return toConversionResponseDto(result.value);
  }

  @Get('conversions/:id')
  @ApiOkResponse({ type: ConversionResponseDto })
  @ApiNotFoundResponse({ description: 'CONVERSION_NOT_FOUND' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversionResponseDto> {
    const result = await this.getConversion.execute({
      ownerId: user.id,
      conversionId: ConversionId.of(id),
    });
    if (result.isErr()) throw result.error;
    return toConversionProgressDto(result.value);
  }
}
