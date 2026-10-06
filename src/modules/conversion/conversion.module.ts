import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { BillingModule } from '../billing/billing.module';
import { DocumentModule } from '../document/document.module';
import { IdentityModule } from '../identity/identity.module';

import { FailConversionUseCase } from './application/use-cases/fail-conversion.use-case';
import { GetConversionUseCase } from './application/use-cases/get-conversion.use-case';
import { ListVoicesUseCase } from './application/use-cases/list-voices.use-case';
import { PrepareConversionUseCase } from './application/use-cases/prepare-conversion.use-case';
import { RescheduleStalledConversionsUseCase } from './application/use-cases/reschedule-stalled-conversions.use-case';
import { StartConversionUseCase } from './application/use-cases/start-conversion.use-case';
import { SynthesizeSegmentUseCase } from './application/use-cases/synthesize-segment.use-case';
import { CONVERSION_JOBS } from './domain/ports/conversion-jobs.port';
import { CONVERSION_REPOSITORY } from './domain/ports/conversion-repository.port';
import { DOCUMENT_TEXT_SOURCE } from './domain/ports/document-text-source.port';
import { QUOTA } from './domain/ports/quota.port';
import { TTS_ENGINE, type TtsPort } from './domain/ports/tts.port';
import { BillingQuotaAdapter } from './infrastructure/billing/billing-quota.adapter';
import { DocumentModuleTextSource } from './infrastructure/document/document-text-source.adapter';
import { DrizzleConversionRepository } from './infrastructure/persistence/conversion.drizzle-repository';
import { QueueConversionJobs } from './infrastructure/queue/conversion-jobs.adapter';
import { ConversionPreparationWorker } from './infrastructure/queue/conversion-preparation.worker';
import { SegmentSynthesisWorker } from './infrastructure/queue/segment-synthesis.worker';
import { RescheduleStalledConversionsJob } from './infrastructure/scheduling/reschedule-stalled-conversions.job';
import { buildTtsEngine } from './infrastructure/tts/tts-engine.factory';
import { ConversionsController } from './interface/http/conversions.controller';
import { VoicesController } from './interface/http/voices.controller';

/**
 * Module conversion, sous-étape 2b (RF-08, RF-21, ADR-0008/0009/0010) :
 * lancement avec réservation du quota, découpage SSML, synthèse segment par
 * segment avec cache. `DocumentModule` fournit le texte, `BillingModule` le
 * quota — chacun derrière un port de ce module. `OBJECT_STORAGE`,
 * `JOB_QUEUE`, `UNIT_OF_WORK` et `CLOCK` viennent des modules globaux.
 */
@Module({
  imports: [IdentityModule, DocumentModule, BillingModule],
  controllers: [ConversionsController, VoicesController],
  providers: [
    { provide: CONVERSION_REPOSITORY, useClass: DrizzleConversionRepository },
    { provide: DOCUMENT_TEXT_SOURCE, useClass: DocumentModuleTextSource },
    { provide: QUOTA, useClass: BillingQuotaAdapter },
    { provide: CONVERSION_JOBS, useClass: QueueConversionJobs },
    {
      provide: TTS_ENGINE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): TtsPort => buildTtsEngine(config),
    },
    StartConversionUseCase,
    GetConversionUseCase,
    ListVoicesUseCase,
    FailConversionUseCase,
    // Pipeline (ADR-0009)
    PrepareConversionUseCase,
    SynthesizeSegmentUseCase,
    RescheduleStalledConversionsUseCase,
    ConversionPreparationWorker,
    SegmentSynthesisWorker,
    RescheduleStalledConversionsJob,
  ],
})
export class ConversionModule {}
