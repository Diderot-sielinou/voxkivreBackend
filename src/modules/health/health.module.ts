import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CheckServicesHealthUseCase,
  HEALTH_PROBES,
} from '@/modules/health/application/use-cases/check-services-health.use-case';
import { SERVICE_CONNECTIVITY } from '@/modules/health/domain/ports/service-connectivity.port';
import { type ProbeConfig } from '@/modules/health/domain/value-objects/probe-config.vo';
import { buildProbeTargets } from '@/modules/health/infrastructure/config/probe-targets';
import { TcpServiceConnectivityAdapter } from '@/modules/health/infrastructure/probes/tcp-service-connectivity.adapter';
import { HealthController } from '@/modules/health/interface/http/health.controller';
import { type Env } from '@/shared/config';

/**
 * Wiring Nest du module : c'est ICI (et seulement ici) que les ports
 * rencontrent leurs adapters. Le use-case reçoit `HEALTH_PROBES` (données)
 * et `SERVICE_CONNECTIVITY` (port) sans savoir d'où ils viennent.
 */
@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: HEALTH_PROBES,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): readonly ProbeConfig[] =>
        buildProbeTargets({
          DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          REDIS_URL: config.get('REDIS_URL', { infer: true }),
          REDIS_HOST: config.get('REDIS_HOST', { infer: true }),
          REDIS_PORT: config.get('REDIS_PORT', { infer: true }),
        }),
    },
    { provide: SERVICE_CONNECTIVITY, useClass: TcpServiceConnectivityAdapter },
    CheckServicesHealthUseCase,
  ],
})
export class HealthModule {}
