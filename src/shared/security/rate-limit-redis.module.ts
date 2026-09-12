import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { type Env } from '@/shared/config';
import { buildRedisOptions } from '@/shared/redis';

/** Client ioredis dédié au throttler ; `null` quand Redis n'est pas configuré. */
export const RATE_LIMIT_REDIS_CLIENT = Symbol('RateLimitRedisClient');

/**
 * Budget max d'un aller-retour Redis sur le chemin de requête. Au-delà, la
 * commande échoue et le store fail-open (cf. `ResilientThrottlerStorage`).
 */
const COMMAND_TIMEOUT_MS = 250;

/**
 * Possède le client Redis du rate-limiter (création, handler d'erreurs,
 * fermeture au drain). Séparé du client partagé `REDIS_CLIENT` parce que les
 * réglages diffèrent : ici "chemin de requête" (`enableOfflineQueue: false`,
 * timeout court, 1 retry) ; là "worker BullMQ" (`maxRetriesPerRequest: null`)
 * — réglage qui faisait pendre chaque requête quand Redis était down.
 */
@Module({
  providers: [
    {
      provide: RATE_LIMIT_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis | null => {
        const hasRedis =
          config.get('REDIS_URL', { infer: true }) !== undefined ||
          config.get('REDIS_HOST', { infer: true }) !== undefined;
        if (!hasRedis) return null;

        const { url, options } = buildRedisOptions(config);
        const requestPathOptions = {
          ...options,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: COMMAND_TIMEOUT_MS,
        };
        const client =
          url === undefined ? new Redis(requestPathOptions) : new Redis(url, requestPathOptions);

        const logger = new Logger('RateLimitRedis');
        // Sans handler, ioredis loggue sur console.error ; on route vers Pino.
        client.on('error', (error: Error) => {
          logger.warn(`redis error: ${error.message}`);
        });
        // Connexion amorcée au boot (lazyConnect) pour que la 1re requête ne
        // paie pas le handshake ; un échec ici n'est pas bloquant.
        client.connect().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(`initial connect failed (will retry in background): ${message}`);
        });
        return client;
      },
    },
  ],
  exports: [RATE_LIMIT_REDIS_CLIENT],
})
export class RateLimitRedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RateLimitRedisModule.name);

  constructor(@Inject(RATE_LIMIT_REDIS_CLIENT) private readonly client: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client === null) return;
    try {
      await this.client.quit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`quit() failed during shutdown: ${message}`);
    }
  }
}
