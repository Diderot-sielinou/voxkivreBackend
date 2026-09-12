import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Contexte propagé pour chaque requête HTTP via AsyncLocalStorage : lisible
 * de n'importe où dans la stack (use-case, repository, filter) sans le passer
 * en argument. Posé par `requestContextMiddleware`.
 */
export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
