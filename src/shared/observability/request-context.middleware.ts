import { randomUUID } from 'node:crypto';

import { type NextFunction, type Request, type Response } from 'express';

import { requestContext } from './request-context';

const HEADER_NAME = 'x-request-id';

/**
 * Pose le request-id (entête entrante prioritaire — le mobile peut en
 * fournir un pour tracer un parcours — sinon UUID généré) dans
 * l'AsyncLocalStorage puis l'écho dans la réponse.
 *
 * À installer en PREMIER (`app.use`) pour que tous les middlewares/handlers
 * en aval aient accès au contexte.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[HEADER_NAME];
  const fromHeader = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = fromHeader && fromHeader.length > 0 ? fromHeader : randomUUID();

  res.setHeader(HEADER_NAME, requestId);

  requestContext.run({ requestId }, () => {
    next();
  });
}
