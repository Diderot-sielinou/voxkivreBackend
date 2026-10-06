/** Client ioredis "producteur" (chemin de requête : échoue vite). */
export const QUEUE_PRODUCER_REDIS = Symbol('QueueProducerRedis');

/** Défauts des tâches (jobs-and-pipeline.md). */
export const DEFAULT_JOB_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_DELAY_MS = 5000;
/** Tâches terminées gardées 24 h (inspection), échouées gardées (la base reste la DLQ). */
export const COMPLETED_JOB_RETENTION_SECONDS = 24 * 60 * 60;
