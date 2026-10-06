import { type ConfigService } from '@nestjs/config';
import { type Job, UnrecoverableError } from 'bullmq';

import { type Env } from '@/shared/config';

import { type ExtractDocumentTextUseCase } from '../../application/use-cases/extract-document-text.use-case';
import { type FailDocumentExtractionUseCase } from '../../application/use-cases/fail-document-extraction.use-case';

import { DocumentExtractionWorker } from './document-extraction.worker';

const ID = '01a11019-f2e7-7014-8369-af25cb7e0f0b';

function setup() {
  const extracted: string[] = [];
  const failed: string[] = [];
  const worker = new DocumentExtractionWorker(
    { get: () => false } as unknown as ConfigService<Env, true>,
    {
      execute: (id: string) => {
        extracted.push(id);
        return Promise.resolve({ kind: 'skipped' });
      },
    } as unknown as ExtractDocumentTextUseCase,
    {
      execute: (id: string) => {
        failed.push(id);
        return Promise.resolve();
      },
    } as unknown as FailDocumentExtractionUseCase,
  );
  return { worker, extracted, failed };
}

const job = (data: unknown) => ({ id: 'j1', data }) as Job;

describe('DocumentExtractionWorker', () => {
  it('validates the payload and hands the document id to the use-case', async () => {
    const { worker, extracted } = setup();
    await worker.handle(job({ documentId: ID }));
    expect(extracted).toEqual([ID]);
  });

  it('marks an invalid payload as unrecoverable (no pointless retries)', async () => {
    const { worker, extracted } = setup();
    await expect(worker.handle(job({ documentId: 'nope' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(extracted).toEqual([]);
  });

  it('marks the document failed when the job is out of attempts', async () => {
    const { worker, failed } = setup();
    await worker.onFinalFailure(job({ documentId: ID }));
    await worker.onFinalFailure(job({ garbage: true }));
    expect(failed).toEqual([ID]);
  });

  it('starts no BullMQ worker when JOB_WORKERS_ENABLED=false', async () => {
    const { worker } = setup();
    worker.onApplicationBootstrap();
    await expect(worker.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
