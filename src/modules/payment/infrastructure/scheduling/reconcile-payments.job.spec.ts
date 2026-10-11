import { Logger } from '@nestjs/common';

import {
  type ReconcilePendingPaymentsUseCase,
  type ReconciliationReport,
} from '../../application/use-cases/reconcile-pending-payments.use-case';

import { ReconcilePaymentsJob } from './reconcile-payments.job';

const EMPTY: ReconciliationReport = {
  examined: 0,
  succeeded: 0,
  failed: 0,
  amount_mismatch: 0,
  waiting: 0,
  unchanged: 0,
  raced: 0,
  anomaly: 0,
  expired: 0,
  unavailable: 0,
};

describe('ReconcilePaymentsJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs a non-empty run only, and never lets an error escape the cron', async () => {
    const logged: { level: string; payload: unknown }[] = [];
    for (const level of ['log', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push({ level, payload: args[0] });
      });
    }
    const job = (execute: () => Promise<ReconciliationReport>) =>
      new ReconcilePaymentsJob({ execute } as unknown as ReconcilePendingPaymentsUseCase);

    await job(() => Promise.resolve(EMPTY)).run();
    await job(() => Promise.resolve({ ...EMPTY, examined: 2, succeeded: 1, waiting: 1 })).run();
    await expect(job(() => Promise.reject(new Error('db down'))).run()).resolves.toBeUndefined();

    expect(logged.map((entry) => entry.level)).toStrictEqual(['log', 'error']);
    expect(logged[0].payload).toMatchObject({ examined: 2, succeeded: 1, waiting: 1 });
  });
});
