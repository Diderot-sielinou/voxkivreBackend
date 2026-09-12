import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type RedisOptions } from 'ioredis';

import { type Env } from '@/shared/config';

import { REDIS_CLIENT } from './redis.constants';

const DEFAULT_LOCAL_HOST = '127.0.0.1';

/**
 * Options ioredis dérivées de l'env, partagées par tous les consommateurs
 * (client partagé, rate-limit store, BullMQ). `REDIS_URL` (Railway) prime ;
 * sinon `REDIS_HOST`/`REDIS_PORT` avec fallback localhost en dev.
 */
export function buildRedisOptions(config: ConfigService<Env, true>): {
  url: string | undefined;
  options: RedisOptions;
} {
  const configuredHost = config.get('REDIS_HOST', { infer: true });
  const options: RedisOptions = {
    host:
      configuredHost === undefined || configuredHost === '' ? DEFAULT_LOCAL_HOST : configuredHost,
    port: config.get('REDIS_PORT', { infer: true }),
    ...(config.get('REDIS_TLS', { infer: true }) ? { tls: {} } : {}),
    // La socket n'est ouverte qu'à la 1re commande : boot sans Redis en dev.
    lazyConnect: true,
    // Reconnecte indéfiniment ; une commande échoue (dégradation locale)
    // plutôt que de crasher l'app sur un blip réseau.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
  return { url: config.get('REDIS_URL', { infer: true }), options };
}

/**
 * Module global qui expose un client ioredis partagé (`REDIS_CLIENT`).
 * Même pattern que `DrizzleModule` : factory, connexion lazy, fermeture
 * propre en `OnApplicationShutdown`.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis => {
        const { url, options } = buildRedisOptions(config);
        return url === undefined ? new Redis(options) : new Redis(url, options);
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // `quit()` flush les commandes en cours avant de fermer. Jamais ouverte
    // (lazyConnect) → résout immédiatement sans I/O.
    this.logger.log('Closing Redis connection');
    try {
      await this.redis.quit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis quit() failed during shutdown: ${message}`);
    }
  }
}
