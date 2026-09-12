import { Controller, Get, HttpCode, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';

import { CheckServicesHealthUseCase } from '@/modules/health/application/use-cases/check-services-health.use-case';
import {
  LivenessResponseDto,
  ServicesHealthResponseDto,
} from '@/modules/health/interface/http/dto/services-health-response.dto';
import { toServicesHealthResponseDto } from '@/modules/health/interface/http/mappers/service-check.mapper';

/**
 * Routes de santé, `VERSION_NEUTRAL` (pas de `/v1` : consommées par la
 * plateforme, pas par l'app mobile).
 *
 * - `GET /health`          : liveness — le process répond. Healthcheck Railway.
 * - `GET /health/services` : readiness — Postgres/Redis joignables ?
 *   503 si un service configuré est injoignable (le body reste informatif),
 *   200 sinon. Un orchestrateur ne lit que le status.
 */
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly checkServicesHealth: CheckServicesHealthUseCase) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LivenessResponseDto })
  getLiveness(): LivenessResponseDto {
    return { status: 'ok' };
  }

  @Get('services')
  @ApiOkResponse({ type: ServicesHealthResponseDto })
  @ApiServiceUnavailableResponse({ type: ServicesHealthResponseDto })
  async getServices(@Res({ passthrough: true }) res: Response): Promise<ServicesHealthResponseDto> {
    const report = await this.checkServicesHealth.execute();
    res.status(report.healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return toServicesHealthResponseDto(report);
  }
}
