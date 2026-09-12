import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';
import { type Redis } from 'ioredis';

import { type Env } from '@/shared/config';
import { RATE_LIMITER_NAME_DEFAULT } from '@/shared/constants';

import { RATE_LIMIT_REDIS_CLIENT, RateLimitRedisModule } from './rate-limit-redis.module';
import { ResilientThrottlerStorage } from './resilient-throttler-storage';

/**
 * Rate limiting global — bucket par IP par défaut, actif sur TOUS les
 * endpoints via `APP_GUARD`. Les buckets dérogatoires (demande d'OTP :
 * beaucoup plus strict ; RNF-28 anti-abus du palier gratuit) se déclarent
 * au niveau du contrôleur via `@Throttle({ [RATE_LIMITER_NAME_DEFAULT]: … })`.
 *
 * Store :
 * - Redis configuré → store partagé entre instances (un store in-memory
 *   serait bypassable par scaling horizontal ; imposé en production par le
 *   schéma Zod), enveloppé dans `ResilientThrottlerStorage` : Redis
 *   injoignable ⇒ fail-open + warn, jamais une requête bloquée.
 * - Sinon (dev sans Redis) → store in-memory de `@nestjs/throttler`.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RateLimitRedisModule],
      inject: [ConfigService, RATE_LIMIT_REDIS_CLIENT],
      useFactory: (config: ConfigService<Env, true>, redis: Redis | null) => {
        const throttlers = [
          {
            name: RATE_LIMITER_NAME_DEFAULT,
            ttl: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
            limit: config.get('RATE_LIMIT_MAX', { infer: true }),
          },
        ];
        if (redis === null) {
          return { throttlers };
        }
        const logger = new Logger('RateLimit');
        const inner: ThrottlerStorage = new ThrottlerStorageRedisService(redis);
        return {
          throttlers,
          storage: new ResilientThrottlerStorage(inner, {
            warn: (msg) => {
              logger.warn(msg);
            },
          }),
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
