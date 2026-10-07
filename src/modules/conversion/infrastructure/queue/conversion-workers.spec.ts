import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { type Job, UnrecoverableError } from 'bullmq';

import { type Env } from '@/shared/config';

import { type FailConversionUseCase } from '../../application/use-cases/fail-conversion.use-case';
import { type PrepareConversionUseCase } from '../../application/use-cases/prepare-conversion.use-case';
import { type SynthesizeSegmentUseCase } from '../../application/use-cases/synthesize-segment.use-case';

import { ConversionPreparationWorker } from './conversion-preparation.worker';
import { SegmentSynthesisWorker } from './segment-synthesis.worker';

const ID = '01a11019-f2e7-7014-8369-af25cb7e0f0c';
const disabled = { get: () => false } as unknown as ConfigService<Env, true>;
const job = (data: unknown) => ({ id: 'j1', data }) as Job;
const exhausted = new Error('boom');

/** Use-case dont la sortie est scriptée, et `FailConversionUseCase` qui enregistre ses appels. */
function recorder(outcomes: unknown[]) {
  const calls: unknown[][] = [];
  const failures: unknown[][] = [];
  const useCase = {
    execute: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(outcomes.shift() ?? { kind: 'skipped' });
    },
  };
  const fail = {
    execute: (...args: unknown[]) => {
      failures.push(args);
      return Promise.resolve(failures.length === 1);
    },
  } as unknown as FailConversionUseCase;
  return { calls, failures, useCase, fail };
}

/** Messages des logs comptables émis (observability.md). */
function businessLogs() {
  const messages: string[] = [];
  const capture = (_payload: unknown, message: unknown) => {
    if (typeof message === 'string') messages.push(message);
  };
  jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
  return messages;
}

describe('conversion workers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preparation: validates, delegates, logs a failure, and fails the conversion once out of attempts', async () => {
    const logs = businessLogs();
    const { calls, failures, useCase, fail } = recorder([
      { kind: 'prepared', segmentCount: 3 },
      { kind: 'failed', reason: 'text_changed' },
    ]);
    const worker = new ConversionPreparationWorker(
      disabled,
      useCase as unknown as PrepareConversionUseCase,
      fail,
    );
    await worker.handle(job({ conversionId: ID }));
    await worker.handle(job({ conversionId: ID }));
    expect(calls).toEqual([[ID], [ID]]);
    await expect(worker.handle(job({ conversionId: 'x' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await worker.onFinalFailure(job({ conversionId: ID }), exhausted);
    await worker.onFinalFailure(job({ conversionId: ID }), exhausted); // déjà échouée : pas de 2e log
    await worker.onFinalFailure(job({}), exhausted);
    expect(failures).toEqual([
      [ID, 'internal'],
      [ID, 'internal'],
    ]);
    expect(logs.filter((m) => m === 'conversion.failed')).toHaveLength(2);
    worker.onApplicationBootstrap();
    await expect(worker.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('synthesis: validates, delegates, logs a rejection, fails once out of attempts', async () => {
    const logs = businessLogs();
    const { calls, failures, useCase, fail } = recorder([
      { kind: 'synthesized', cacheHit: false, conversionCompleted: true },
      { kind: 'rejected' },
    ]);
    const worker = new SegmentSynthesisWorker(
      disabled,
      useCase as unknown as SynthesizeSegmentUseCase,
      fail,
    );
    await worker.handle(job({ conversionId: ID, segmentIndex: 4 }));
    await worker.handle(job({ conversionId: ID, segmentIndex: 5 }));
    expect(calls).toEqual([
      [ID, 4],
      [ID, 5],
    ]);
    await expect(worker.handle(job({ conversionId: ID, segmentIndex: -1 }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await worker.onFinalFailure(job({ conversionId: ID, segmentIndex: 4 }), exhausted);
    await worker.onFinalFailure(job({ conversionId: ID }), exhausted);
    expect(failures).toEqual([[ID, 'internal']]);
    expect(logs.filter((m) => m === 'conversion.failed')).toHaveLength(2);
    worker.onApplicationBootstrap();
    await expect(worker.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
