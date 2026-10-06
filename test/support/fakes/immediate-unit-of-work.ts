import { type TxContext, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

/** UnitOfWork sans base : exécute la fonction avec un `tx` marqueur, compte les appels. */
export class ImmediateUnitOfWork implements UnitOfWorkPort {
  static readonly TX = Symbol('fake-tx');
  calls = 0;

  withTransaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    this.calls += 1;
    return fn(ImmediateUnitOfWork.TX);
  }
}
