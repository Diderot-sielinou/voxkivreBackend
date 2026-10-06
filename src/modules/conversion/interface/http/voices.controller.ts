import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { ListVoicesUseCase } from '@/modules/conversion/application/use-cases/list-voices.use-case';
import { SessionGuard } from '@/modules/identity/interface/http/session.guard';

import { VoiceListResponseDto } from './dto/voice-list-response.dto';
import { toVoiceListResponseDto } from './mappers/conversion.mapper';

/** Voix proposées au lancement d'une conversion (RF-21). */
@ApiTags('conversions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'voices', version: '1' })
@UseGuards(SessionGuard)
export class VoicesController {
  constructor(private readonly listVoices: ListVoicesUseCase) {}

  @Get()
  @ApiOkResponse({ type: VoiceListResponseDto })
  list(): VoiceListResponseDto {
    return toVoiceListResponseDto(this.listVoices.execute());
  }
}
