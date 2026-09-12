import { type ThrottlerStorage } from '@nestjs/throttler';
// Non ré-exporté par le barrel de @nestjs/throttler : import par chemin interne.
import { type ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

/** Logger minimal pour rester découplé de Nest dans les tests. */
export interface ResilientStorageLogger {
  warn(message: string): void;
}

/**
 * Décorateur de `ThrottlerStorage` qui **fail-open** : si le store sous-jacent
 * (Redis) throw ou dépasse son `commandTimeout`, la requête est laissée
 * passer et l'incident est loggé.
 *
 * Pourquoi : observé en local — Redis arrêté ⇒ chaque requête de l'API pend
 * indéfiniment (ioredis met les commandes en file d'attente pendant la
 * reconnexion). Un rate-limiter ne doit jamais être un point de panne
 * unique : une panne Redis dégrade la protection anti-abus, elle ne doit pas
 * rendre l'app indisponible. Le choix inverse (fail-closed → 503) est
 * documenté comme rejeté pour le MVP ; `/health/services` reflète l'incident.
 */
export class ResilientThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly inner: ThrottlerStorage,
    private readonly logger: ResilientStorageLogger,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.inner.increment(key, ttl, limit, blockDuration, throttlerName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `rate-limit store unavailable, failing open (throttler=${throttlerName}): ${message}`,
      );
      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
