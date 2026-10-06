import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { GetQuotaUseCase } from '@/modules/billing/application/use-cases/get-quota.use-case';
import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';

import { QuotaResponseDto } from './dto/quota-response.dto';

/** Quota de l'utilisateur connecté, à afficher avant de lancer une conversion. */
@ApiTags('billing')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'quota', version: '1' })
@UseGuards(SessionGuard)
export class QuotaController {
  constructor(private readonly getQuota: GetQuotaUseCase) {}

  @Get()
  @ApiOkResponse({ type: QuotaResponseDto })
  async get(@CurrentUser() user: AuthenticatedUser): Promise<QuotaResponseDto> {
    // Valeurs déjà au format du contrat HTTP (aucune entité exposée).
    return { ...(await this.getQuota.execute(user.id)) };
  }
}
