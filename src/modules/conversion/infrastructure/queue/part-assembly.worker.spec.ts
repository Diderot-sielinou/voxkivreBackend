import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { type Job, UnrecoverableError } from 'bullmq';

import { type Env } from '@/shared/config';

import { type AssemblePartUseCase } from '../../application/use-cases/assemble-part.use-case';

import { PartAssemblyWorker } from './part-assembly.worker';

const ID = '01a11019-f2e7-7014-8369-af25cb7e0f0c';
const disabled = { get: () => false } as unknown as ConfigService<Env, true>;
const job = (data: unknown) => ({ id: 'j1', data }) as Job;

describe('PartAssemblyWorker', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('validates the payload, delegates, logs completion, and never fails the conversion', async () => {
    const messages: string[] = [];
    const capture = (_payload: unknown, message: unknown) => {
      if (typeof message === 'string') messages.push(message);
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);
    const calls: unknown[][] = [];
    const useCase = {
      execute: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ kind: 'assembled', durationMs: 1, conversionReady: true });
      },
    } as unknown as AssemblePartUseCase;
    const worker = new PartAssemblyWorker(disabled, useCase);

    await worker.handle(job({ conversionId: ID, partIndex: 3 }));
    expect(calls).toEqual([[ID, 3]]);
    expect(messages).toContain('conversion.completed');
    await expect(worker.handle(job({ conversionId: ID }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await worker.onFinalFailure(job({ conversionId: ID, partIndex: 3 }), new Error('s3 down'));
    expect(messages.at(-1)).toMatch(/sweeper will retry/u);
    worker.onApplicationBootstrap();
    await expect(worker.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
