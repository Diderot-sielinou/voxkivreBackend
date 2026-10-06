import { DomainError } from '@/shared/kernel';

export const QUEUE_ERROR_CODES = {
  QUEUE_UNAVAILABLE: 'INFRASTRUCTURE_QUEUE_UNAVAILABLE',
} as const;

/** Redis injoignable : la tâche n'a pas pu être mise en file (503, RNF-11). */
export class QueueUnavailableError extends DomainError {
  readonly code = QUEUE_ERROR_CODES.QUEUE_UNAVAILABLE;
}
