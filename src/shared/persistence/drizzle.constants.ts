/**
 * Token DI de la connexion Drizzle. Les repositories l'injectent via
 * `@Inject(DRIZZLE_CLIENT)` et typent `private readonly db: DrizzleClient`.
 */
export const DRIZZLE_CLIENT = Symbol('DrizzleClient');
