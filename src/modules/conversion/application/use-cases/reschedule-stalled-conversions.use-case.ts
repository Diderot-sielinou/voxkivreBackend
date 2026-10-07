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
/** Délai sans activité avant de reprogrammer les segments ou les assemblages en attente. */
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

    const stalled = await this.conversions.findStalled(
      [ConversionStatus.SYNTHESIZING, ConversionStatus.SYNTHESIZED],
      new Date(now - STALLED_SYNTHESIS_AFTER_MS),
      RESCHEDULE_BATCH_SIZE,
    );
    // Une tâche d'assemblage échouée garde son `jobId` dans Redis : la clé de
    // relance (minute du balayage) permet de la reprogrammer (ADR-0011).
    const retryKey = `sweep-${String(Math.floor(now / 60_000))}`;
    for (const { id } of stalled) {
      const pending = await this.conversions.listPendingSegmentIndexes(id);
      const assemblable = await this.conversions.listAssemblablePartIndexes(id);
      if (pending.length === 0 && assemblable.length === 0) continue;
      if (pending.length > 0) await this.jobs.scheduleSynthesis(id, pending);
      for (const partIndex of assemblable) {
        await this.jobs.scheduleAssembly(id, partIndex, retryKey);
      }
      rescheduled += 1;
    }
    return rescheduled;
  }
}
