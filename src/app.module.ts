import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import { HealthModule } from '@/modules/health/health.module';
import { IdentityModule } from '@/modules/identity/identity.module';
import { ClockModule } from '@/shared/clock';
import { AppConfigModule } from '@/shared/config';
import { AppLoggerModule } from '@/shared/observability';
import { DrizzleModule } from '@/shared/persistence';
import { RedisModule } from '@/shared/redis';
import { RateLimitModule } from '@/shared/security';

/**
 * Racine de composition. Ordre : config d'abord (tout le reste en dépend),
 * puis les modules techniques globaux, puis les modules métier (à venir :
 * health, identity, document, conversion, library, billing, payment).
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    ClockModule,
    DrizzleModule,
    RedisModule,
    RateLimitModule,
    ScheduleModule.forRoot(),
    // Bus d'événements de domaine in-process. `wildcard: false` : les
    // listeners s'abonnent à des noms exacts (`conversion.completed`).
    EventEmitterModule.forRoot({ wildcard: false }),
    // --- Modules métier ---------------------------------------------------
    // Santé (liveness/readiness). Aucune dépendance métier ; module gabarit.
    HealthModule,
    // Authentification OTP (better-auth) + `SessionGuard` + /v1/me. Chargé
    // avant tout module métier qui protège ses routes.
    IdentityModule,
  ],
})
export class AppModule {}
