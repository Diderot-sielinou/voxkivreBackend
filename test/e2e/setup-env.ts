/**
 * Variables d'environnement minimales pour booter l'AppModule en e2e.
 * Chargé par Jest AVANT les tests (`setupFiles`). Les valeurs sont des
 * placeholders : les adapters réseau (Postgres, Redis) sont lazy et/ou
 * overridés par les tests — aucun I/O réel n'est attendu ici.
 */
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.PORT ??= '0';
process.env.DB_HOST ??= 'localhost';
process.env.DB_NAME ??= 'voxlivre_test';
process.env.DB_USER ??= 'voxlivre';
process.env.DB_PASSWORD ??= 'voxlivre';
process.env.BETTER_AUTH_SECRET ??= 'e2e-secret-at-least-32-characters-long!!';
process.env.BETTER_AUTH_URL ??= 'http://localhost:8080';
// Pas de base en e2e : compteurs de rate-limit better-auth en mémoire.
process.env.AUTH_RATE_LIMIT_STORAGE ??= 'memory';
