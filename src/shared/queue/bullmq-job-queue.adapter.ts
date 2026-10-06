import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { type Redis } from 'ioredis';

import { type EnqueueJobInput, type JobQueuePort } from './job-queue.port';
import {
  COMPLETED_JOB_RETENTION_SECONDS,
  DEFAULT_BACKOFF_DELAY_MS,
  DEFAULT_JOB_ATTEMPTS,
} from './queue.constants';
import { QueueUnavailableError } from './queue.errors';

/**
 * Producteur BullMQ. Une instance `Queue` par nom de file, créée à la
 * demande et partageant le client "producteur" (fail-fast, ADR-0002) : une
 * requête HTTP ne doit jamais pendre parce que Redis redémarre.
 */
export class BullMqJobQueueAdapter implements JobQueuePort, OnApplicationShutdown {
  private readonly logger = new Logger(BullMqJobQueueAdapter.name);
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly connection: Redis) {}

  async enqueue(job: EnqueueJobInput): Promise<void> {
    try {
      await this.queueFor(job.queue).add(job.name, job.payload, {
        jobId: job.jobId,
        attempts: job.attempts ?? DEFAULT_JOB_ATTEMPTS,
        ...(job.priority === undefined ? {} : { priority: job.priority }),
        backoff: { type: 'exponential', delay: DEFAULT_BACKOFF_DELAY_MS },
        removeOnComplete: { age: COMPLETED_JOB_RETENTION_SECONDS },
        removeOnFail: false,
      });
    } catch (error) {
      this.logger.error({ err: error, queue: job.queue, jobId: job.jobId }, 'Enqueue failed');
      throw new QueueUnavailableError('Job queue is temporarily unavailable', { cause: error });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }

  private queueFor(name: string): Queue {
    let queue = this.queues.get(name);
    if (queue === undefined) {
      queue = new Queue(name, { connection: this.connection });
      // Sans handler, une erreur de connexion devient un 'error' non écouté.
      queue.on('error', (error: Error) => {
        this.logger.warn(`queue ${name} error: ${error.message}`);
      });
      this.queues.set(name, queue);
    }
    return queue;
  }
}
