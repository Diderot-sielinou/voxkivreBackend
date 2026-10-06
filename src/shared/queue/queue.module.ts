import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { type Env } from '@/shared/config';
import { buildRedisOptions } from '@/shared/redis';

import { BullMqJobQueueAdapter } from './bullmq-job-queue.adapter';
import { JOB_QUEUE } from './job-queue.port';
import { QUEUE_PRODUCER_REDIS } from './queue.constants';

/** Budget d'un `add` sur le chemin de requête (plus large que le rate-limit : script Lua). */
const PRODUCER_COMMAND_TIMEOUT_MS = 1000;

/**
 * Module global de mise en file (ADR-0009). Le client "producteur" est
 * réglé chemin de requête (pas d'offline queue, timeout court) : Redis
 * arrêté → 503 `INFRASTRUCTURE_QUEUE_UNAVAILABLE` en quelques ms au lieu
 * d'une requête qui pend (même leçon qu'ADR-0002). Les workers ont leurs
 * propres connexions (`createJobWorker`).
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_PRODUCER_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis => {
        const { url, options } = buildRedisOptions(config);
        const producerOptions = {
          ...options,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: PRODUCER_COMMAND_TIMEOUT_MS,
        };
        const client =
          url === undefined ? new Redis(producerOptions) : new Redis(url, producerOptions);
        const logger = new Logger('QueueProducerRedis');
        client.on('error', (error: Error) => {
          logger.warn(`redis error: ${error.message}`);
        });
        return client;
      },
    },
    {
      provide: JOB_QUEUE,
      inject: [QUEUE_PRODUCER_REDIS],
      useFactory: (redis: Redis): BullMqJobQueueAdapter => new BullMqJobQueueAdapter(redis),
    },
  ],
  exports: [JOB_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(JOB_QUEUE) private readonly queue: BullMqJobQueueAdapter,
    @Inject(QUEUE_PRODUCER_REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.onApplicationShutdown();
    // Jamais connecté (lazyConnect) → `disconnect` évite un quit() qui attendrait.
    this.redis.disconnect();
  }
}
