import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import Redis, { type RedisOptions } from 'ioredis';

/** Gestionnaire d'une file : reçoit le payload BRUT (à valider par Zod). */
export interface JobHandler {
  /** Exécute la tâche. Throw = nouvel essai ; `UnrecoverableError` = échec définitif. */
  handle(job: Job): Promise<void>;
  /** Appelé une seule fois quand la tâche a épuisé ses essais (ou est irrécupérable). */
  onFinalFailure(job: Job, error: Error): Promise<void>;
}

/** Worker démarré ; `close()` attend la tâche en cours puis libère SA connexion. */
export interface JobWorkerHandle {
  close(): Promise<void>;
}

export interface WorkerConnection {
  readonly url: string | undefined;
  readonly options: RedisOptions;
}

/**
 * Crée un `Worker` BullMQ avec sa propre connexion Redis "worker"
 * (`maxRetriesPerRequest: null` : il DOIT attendre la reconnexion, à
 * l'inverse du chemin de requête). Logs début/fin/échec homogènes
 * (jobs-and-pipeline.md).
 *
 * BullMQ ne ferme pas une connexion qu'on lui fournit : le handle renvoyé
 * ferme le worker PUIS le client Redis — sinon la socket ouverte empêche le
 * processus de s'arrêter au redéploiement.
 */
export function createJobWorker(
  queueName: string,
  handler: JobHandler,
  connection: WorkerConnection,
  concurrency: number,
): JobWorkerHandle {
  const logger = new Logger(`Worker:${queueName}`);
  const options: RedisOptions = { ...connection.options, maxRetriesPerRequest: null };
  const redis =
    connection.url === undefined ? new Redis(options) : new Redis(connection.url, options);

  const worker = new Worker(
    queueName,
    async (job: Job) => {
      const started = Date.now();
      const context = {
        queue: queueName,
        jobName: job.name,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
      };
      logger.log(context, 'Job started');
      await handler.handle(job);
      logger.log({ ...context, durationMs: Date.now() - started }, 'Job completed');
    },
    { connection: redis, concurrency },
  );

  worker.on('failed', (job: Job | undefined, error: Error) => {
    if (job === undefined) return;
    const attempts = job.opts.attempts ?? 1;
    const final = error instanceof UnrecoverableError || job.attemptsMade >= attempts;
    logger.warn({ jobId: job.id, attempt: job.attemptsMade, final, err: error }, 'Job failed');
    if (!final) return;
    handler.onFinalFailure(job, error).catch((hookError: unknown) => {
      logger.error({ jobId: job.id, err: hookError }, 'Final failure handler failed');
    });
  });
  worker.on('error', (error: Error) => {
    logger.warn(`worker error: ${error.message}`);
  });
  return {
    close: async () => {
      await worker.close();
      redis.disconnect();
    },
  };
}
