import { type NestExpressApplication } from '@nestjs/platform-express';

import { requestContextMiddleware } from '@/shared/observability';

/**
 * Middleware ALS request-context — DOIT être enregistré avant tout autre
 * middleware applicatif pour que logs et handlers en aval aient un
 * request-id.
 */
export function configureRequestContext(app: NestExpressApplication): void {
  app.use(requestContextMiddleware);
}
