import { Inject, Injectable, Logger } from '@nestjs/common';

import { JOB_QUEUE, type JobQueuePort } from '@/shared/queue/job-queue.port';

import { type ConversionJobsPort } from '../../domain/ports/conversion-jobs.port';
import { type ConversionId } from '../../domain/value-objects/conversion-id.vo';

import {
  ASSEMBLE_PART_ATTEMPTS,
  ASSEMBLE_PART_JOB,
  assemblePartJobId,
  CONVERSION_ASSEMBLY_QUEUE,
  CONVERSION_PREPARE_QUEUE,
  CONVERSION_SYNTHESIS_QUEUE,
  MAX_JOB_PRIORITY,
  PREPARE_CONVERSION_ATTEMPTS,
  PREPARE_CONVERSION_JOB,
  prepareConversionJobId,
  SYNTHESIZE_SEGMENT_ATTEMPTS,
  SYNTHESIZE_SEGMENT_JOB,
  synthesizeSegmentJobId,
} from './conversion-jobs.constants';

/** Programme les tâches de la conversion dans BullMQ (`jobId` déterministes). */
@Injectable()
export class QueueConversionJobs implements ConversionJobsPort {
  private readonly logger = new Logger(QueueConversionJobs.name);

  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueuePort) {}

  async schedulePreparation(id: ConversionId): Promise<boolean> {
    try {
      await this.queue.enqueue({
        queue: CONVERSION_PREPARE_QUEUE,
        name: PREPARE_CONVERSION_JOB,
        jobId: prepareConversionJobId(id),
        payload: { conversionId: id },
        attempts: PREPARE_CONVERSION_ATTEMPTS,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        { err: error, conversionId: id },
        'Preparation not scheduled; the stalled-conversion sweeper will retry',
      );
      return false;
    }
  }

  async scheduleSynthesis(id: ConversionId, segmentIndexes: readonly number[]): Promise<void> {
    for (const index of segmentIndexes) {
      await this.queue.enqueue({
        queue: CONVERSION_SYNTHESIS_QUEUE,
        name: SYNTHESIZE_SEGMENT_JOB,
        jobId: synthesizeSegmentJobId(id, index),
        payload: { conversionId: id, segmentIndex: index },
        attempts: SYNTHESIZE_SEGMENT_ATTEMPTS,
        priority: Math.min(index + 1, MAX_JOB_PRIORITY),
      });
    }
  }

  async scheduleAssembly(id: ConversionId, partIndex: number, retryKey?: string): Promise<void> {
    await this.queue.enqueue({
      queue: CONVERSION_ASSEMBLY_QUEUE,
      name: ASSEMBLE_PART_JOB,
      jobId: assemblePartJobId(id, partIndex, retryKey),
      payload: { conversionId: id, partIndex },
      attempts: ASSEMBLE_PART_ATTEMPTS,
    });
  }
}
