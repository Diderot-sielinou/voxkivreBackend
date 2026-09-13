import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { GetCurrentUserUseCase } from '@/modules/identity/application/use-cases/get-current-user.use-case';
import { UserId } from '@/modules/identity/domain/value-objects/user-id.vo';

import { CurrentUser } from './current-user.decorator';
import { MeResponseDto } from './dto/me-response.dto';
import { toMeResponseDto } from './mappers/me.mapper';
import { type AuthenticatedUser, SessionGuard } from './session.guard';

/**
 * Profil de l'utilisateur courant. Les routes d'authentification elles-mêmes
 * (envoi/vérification OTP, sign-out) sont servies par better-auth sous
 * `/api/auth/*` — cf. la section "auth" de /docs.
 */
@ApiTags('identity')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
@UseGuards(SessionGuard)
export class MeController {
  constructor(private readonly getCurrentUser: GetCurrentUserUseCase) {}

  @Get()
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    const result = await this.getCurrentUser.execute(UserId.of(user.id));
    if (result.isErr()) throw result.error;
    return toMeResponseDto(result.value);
  }
}
