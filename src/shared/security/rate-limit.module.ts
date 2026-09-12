import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { type Env } from '@/shared/config';
import { RATE_LIMITER_NAME_DEFAULT } from '@/shared/constants';
import { buildRedisOptions } from '@/shared/redis';

/**
 * Rate limiting global — bucket par IP par défaut, actif sur TOUS les
 * endpoints via `APP_GUARD`. Les buckets dérogatoires (demande d'OTP :
 * beaucoup plus strict ; RNF-28 anti-abus du palier gratuit) se déclarent
 * au niveau du contrôleur via `@Throttle({ [RATE_LIMITER_NAME_DEFAULT]: … })`.
 *
 * Store :
 * - Redis configuré → store partagé entre instances (un store in-memory
 *   serait bypassable par scaling horizontal). Imposé en production par le
 *   schéma Zod.
 * - Sinon (dev sans Redis) → store in-memory de `@nestjs/throttler`.
 *
 * Le store Redis possède son propre client ioredis (on lui passe des
 * options, pas une instance) et le ferme via son `OnModuleDestroy`.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const throttlers = [
          {
            name: RATE_LIMITER_NAME_DEFAULT,
            ttl: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
            limit: config.get('RATE_LIMIT_MAX', { infer: true }),
          },
        ];
        const hasRedis =
          config.get('REDIS_URL', { infer: true }) !== undefined ||
          config.get('REDIS_HOST', { infer: true }) !== undefined;
        if (!hasRedis) {
          return { throttlers };
        }
        const { url, options } = buildRedisOptions(config);
        return {
          throttlers,
          storage:
            url === undefined
              ? new ThrottlerStorageRedisService(options)
              : new ThrottlerStorageRedisService(url, options),
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
