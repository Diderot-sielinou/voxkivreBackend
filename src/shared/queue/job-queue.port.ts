/**
 * Port de mise en file de tâches asynchrones (ADR-0009). `application/`
 * dépend de ce port, jamais de `bullmq`.
 *
 * Contrat :
 * - `jobId` **déterministe** obligatoire : remettre en file une tâche déjà
 *   présente (en attente, active, terminée ou échouée) est sans effet. C'est
 *   ce qui rend les relances et le balayage de rattrapage sûrs (RNF-12).
 * - Payload = identifiants + paramètres, jamais une entité ni un texte long.
 * - Redis indisponible → `QueueUnavailableError` (`INFRASTRUCTURE_*`, 503),
 *   levée vite : ce port est appelé sur le chemin de requête HTTP.
 */
export const JOB_QUEUE = Symbol('JobQueue');

export type JobPayload = Readonly<Record<string, string | number | boolean | null>>;

export interface EnqueueJobInput {
  readonly queue: string;
  readonly name: string;
  readonly jobId: string;
  readonly payload: JobPayload;
  /** Nombre total d'essais (défaut 3) ; backoff exponentiel à partir de 5 s. */
  readonly attempts?: number;
  /**
   * Priorité dans la file : 1 = la plus haute. Une file doit être soit
   * entièrement priorisée, soit pas du tout (BullMQ traite à part les
   * tâches sans priorité).
   */
  readonly priority?: number;
}

export interface JobQueuePort {
  enqueue(job: EnqueueJobInput): Promise<void>;
}
