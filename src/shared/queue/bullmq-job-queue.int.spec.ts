import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { type Job, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';

import { BullMqJobQueueAdapter } from './bullmq-job-queue.adapter';
import { createJobWorker, type JobHandler, type JobWorkerHandle } from './job-worker.factory';
import { QUEUE_ERROR_CODES } from './queue.errors';

/** Attend qu'une condition devienne vraie (worker asynchrone). */
async function until(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

class RecordingHandler implements JobHandler {
  readonly handled: string[] = [];
  readonly finalFailures: string[] = [];
  failWith: Error | null = null;

  handle(job: Job): Promise<void> {
    this.handled.push(String(job.id));
    return this.failWith === null ? Promise.resolve() : Promise.reject(this.failWith);
  }

  onFinalFailure(job: Job): Promise<void> {
    this.finalFailures.push(String(job.id));
    return Promise.resolve();
  }
}

/**
 * Contre un vrai Redis : le contrat d'ADR-0009 — dédoublonnage par `jobId`,
 * hook d'échec définitif, producteur qui échoue VITE quand Redis tombe.
 */
describe('BullMQ queue + worker (integration, Testcontainers)', () => {
  let container: StartedRedisContainer;
  let producerRedis: Redis;
  let queue: BullMqJobQueueAdapter;
  let worker: JobWorkerHandle | null = null;

  const connection = () => ({
    url: undefined,
    options: { host: container.getHost(), port: container.getPort(), lazyConnect: true },
  });

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    producerRedis = new Redis({
      host: container.getHost(),
      port: container.getPort(),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
    });
    queue = new BullMqJobQueueAdapter(producerRedis);
  }, 120_000);

  afterEach(async () => {
    await worker?.close();
    worker = null;
  });

  afterAll(async () => {
    await queue.onApplicationShutdown();
    producerRedis.disconnect();
    await container.stop();
  });

  it('runs an enqueued job once, even if it is enqueued twice with the same id', async () => {
    const handler = new RecordingHandler();
    await queue.enqueue({ queue: 'q-dedupe', name: 'job', jobId: 'job-1', payload: { a: 1 } });
    await queue.enqueue({ queue: 'q-dedupe', name: 'job', jobId: 'job-1', payload: { a: 1 } });
    worker = createJobWorker('q-dedupe', handler, connection(), 1);
    await until(() => handler.handled.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(handler.handled).toEqual(['job-1']);
  });

  it('retries a failing job, then calls the final-failure hook exactly once', async () => {
    const handler = new RecordingHandler();
    handler.failWith = new Error('transient');
    worker = createJobWorker('q-retry', handler, connection(), 1);
    await queue.enqueue({
      queue: 'q-retry',
      name: 'job',
      jobId: 'job-2',
      payload: {},
      attempts: 2,
    });
    // 2 essais (backoff de 5 s entre les deux), puis le hook.
    await until(() => handler.finalFailures.length === 1, 20_000);
    expect(handler.handled).toEqual(['job-2', 'job-2']);
    expect(handler.finalFailures).toEqual(['job-2']);
  }, 30_000);

  it('does not retry an unrecoverable error', async () => {
    const handler = new RecordingHandler();
    handler.failWith = new UnrecoverableError('bad payload');
    worker = createJobWorker('q-unrecoverable', handler, connection(), 1);
    await queue.enqueue({ queue: 'q-unrecoverable', name: 'job', jobId: 'job-3', payload: {} });
    await until(() => handler.finalFailures.length === 1);
    expect(handler.handled).toEqual(['job-3']);
  });

  it('fails fast with INFRASTRUCTURE_QUEUE_UNAVAILABLE when Redis is down', async () => {
    const deadRedis = new Redis({
      host: '127.0.0.1',
      port: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
      retryStrategy: () => null,
    });
    const deadQueue = new BullMqJobQueueAdapter(deadRedis);
    const started = Date.now();
    await expect(
      deadQueue.enqueue({ queue: 'q', name: 'job', jobId: 'x', payload: {} }),
    ).rejects.toMatchObject({ code: QUEUE_ERROR_CODES.QUEUE_UNAVAILABLE });
    expect(Date.now() - started).toBeLessThan(3000);
    await deadQueue.onApplicationShutdown();
    deadRedis.disconnect();
  });
});
