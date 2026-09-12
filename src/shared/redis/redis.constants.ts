/**
 * Token DI du client ioredis partagé. Les adapters consommateurs (cache,
 * rate-limit, verrous) font `@Inject(REDIS_CLIENT)` plutôt que d'ouvrir leur
 * propre connexion — un seul pool TCP par instance, lifecycle centralisé.
 * (BullMQ gère ses propres connexions : voir le module queue à venir.)
 */
export const REDIS_CLIENT = Symbol('RedisClient');
