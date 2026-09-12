import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, Injectable } from '@nestjs/common';

import { DRIZZLE_CLIENT } from './drizzle.constants';
import { type DrizzleClient } from './drizzle.module';
import { type TxContext, type UnitOfWorkPort } from './unit-of-work.port';

/**
 * Le client racine OU une transaction en cours : les deux exposent
 * `.transaction(cb)` — sur le client c'est un `BEGIN`, sur une transaction
 * c'est un `SAVEPOINT` (même connexion).
 */
interface TransactionRunner {
  transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
}

/**
 * UnitOfWork Drizzle **réentrant**.
 *
 * `withTransaction` rejoint la transaction ambiante (propagée via
 * `AsyncLocalStorage`) au lieu d'en ouvrir une nouvelle sur une autre
 * connexion du pool. Sans ça, un use-case appelé depuis une transaction
 * parente (ex. webhook paiement → activation d'abonnement) tenterait de
 * re-locker une ligne déjà verrouillée par le parent sur une AUTRE
 * connexion → attente jusqu'au timeout, deadlock invisible pour Postgres.
 */
@Injectable()
export class DrizzleUnitOfWork implements UnitOfWorkPort {
  private readonly activeTx = new AsyncLocalStorage<TxContext>();

  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  withTransaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    const ambient = this.activeTx.getStore();
    // `TxContext` est opaque côté port : la frontière justifie le cast.
    const runner = (ambient ?? this.db) as TransactionRunner;
    return runner.transaction((tx) => this.activeTx.run(tx, () => fn(tx)));
  }
}
