import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';

import { CONVERSION_JOBS, type ConversionJobsPort } from '../../domain/ports/conversion-jobs.port';
import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';

/** Délai avant de considérer qu'une préparation n'a jamais été programmée. */
export const STALLED_QUEUED_AFTER_MS = 2 * 60 * 1000;
/** Délai sans segment terminé avant de reprogrammer les segments en attente. */
export const STALLED_SYNTHESIS_AFTER_MS = 10 * 60 * 1000;
export const RESCHEDULE_BATCH_SIZE = 100;

/**
 * Filet de sécurité (cron, ADR-0009) : reprogramme les conversions restées
 * `queued` (file indisponible au lancement) et les segments en attente des
 * conversions `synthesizing` inactives. Sûr à répéter : programmer deux fois
 * est sans effet. Renvoie le nombre de conversions reprogrammées.
 */
@Injectable()
export class RescheduleStalledConversionsUseCase {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
    @Inject(CONVERSION_JOBS) private readonly jobs: ConversionJobsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now().getTime();
    let rescheduled = 0;

    const queued = await this.conversions.findStalled(
      [ConversionStatus.QUEUED],
      new Date(now - STALLED_QUEUED_AFTER_MS),
      RESCHEDULE_BATCH_SIZE,
    );
    for (const { id } of queued) {
      if (await this.jobs.schedulePreparation(id)) rescheduled += 1;
    }

    const synthesizing = await this.conversions.findStalled(
      [ConversionStatus.SYNTHESIZING],
      new Date(now - STALLED_SYNTHESIS_AFTER_MS),
      RESCHEDULE_BATCH_SIZE,
    );
    for (const { id } of synthesizing) {
      const pending = await this.conversions.listPendingSegmentIndexes(id);
      if (pending.length === 0) continue;
      await this.jobs.scheduleSynthesis(id, pending);
      rescheduled += 1;
    }
    return rescheduled;
  }
}
