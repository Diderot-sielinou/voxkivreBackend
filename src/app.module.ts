import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import { BillingModule } from '@/modules/billing/billing.module';
import { ConversionModule } from '@/modules/conversion/conversion.module';
import { DocumentModule } from '@/modules/document/document.module';
import { HealthModule } from '@/modules/health/health.module';
import { IdentityModule } from '@/modules/identity/identity.module';
import { LibraryModule } from '@/modules/library/library.module';
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
 * library, payment).
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
    // Import de PDF (upload direct pré-signé) + texte page par page.
    DocumentModule,
    // Quota en caractères (réservation / remboursement, ADR-0010).
    BillingModule,
    // Synthèse vocale : lancement, découpage SSML, segments (ADR-0008).
    ConversionModule,
    // Bibliothèque, position de lecture, suppression d'un livre (ADR-0015/0016).
    LibraryModule,
  ],
})
export class AppModule {}
