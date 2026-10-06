import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import { BillingModule } from '@/modules/billing/billing.module';
import { DocumentModule } from '@/modules/document/document.module';
import { HealthModule } from '@/modules/health/health.module';
import { IdentityModule } from '@/modules/identity/identity.module';
import { ClockModule } from '@/shared/clock';
import { AppConfigModule } from '@/shared/config';
import { AppLoggerModule } from '@/shared/observability';
import { CursorCodecModule } from '@/shared/pagination';
import { DrizzleModule } from '@/shared/persistence';
import { QueueModule } from '@/shared/queue';
import { RedisModule } from '@/shared/redis';
import { RateLimitModule } from '@/shared/security';
import { StorageModule } from '@/shared/storage';

/**
 * Racine de composition. Ordre : config d'abord (tout le reste en dépend),
 * puis les modules techniques globaux, puis les modules métier (à venir :
 * conversion, library, payment).
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    ClockModule,
    DrizzleModule,
    RedisModule,
    StorageModule,
    QueueModule,
    CursorCodecModule,
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
    // Import de PDF (upload direct pré-signé) + bibliothèque paginée.
    DocumentModule,
    // Quota en caractères (réservation / remboursement, ADR-0010).
    BillingModule,
  ],
})
export class AppModule {}
