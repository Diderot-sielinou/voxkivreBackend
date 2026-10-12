import { type ConfigService } from '@nestjs/config';
import { type Job, UnrecoverableError } from 'bullmq';

import { type Env } from '@/shared/config';

import { type FailDocumentExtractionUseCase } from '../../application/use-cases/fail-document-extraction.use-case';
import { type RecognizeOcrPagesUseCase } from '../../application/use-cases/recognize-ocr-pages.use-case';

import { DocumentOcrWorker } from './document-ocr.worker';

const ID = '01a11019-f2e7-7014-8369-af25cb7e0f0b';

function setup() {
  const batches: (readonly [string, number])[] = [];
  const failed: string[] = [];
  const worker = new DocumentOcrWorker(
    { get: () => false } as unknown as ConfigService<Env, true>,
    {
      execute: (id: string, fromPage: number) => {
        batches.push([id, fromPage]);
        return Promise.resolve({ kind: 'skipped' });
      },
    } as unknown as RecognizeOcrPagesUseCase,
    {
      execute: (id: string) => {
        failed.push(id);
        return Promise.resolve();
      },
    } as unknown as FailDocumentExtractionUseCase,
  );
  return { worker, batches, failed };
}

const job = (data: unknown) => ({ id: 'j1', data }) as Job;

describe('DocumentOcrWorker', () => {
  it('validates the payload and hands the batch to the use-case', async () => {
    const { worker, batches } = setup();
    await worker.handle(job({ documentId: ID, fromPage: 11 }));
    expect(batches).toEqual([[ID, 11]]);
  });

  it.each([
    [{ documentId: ID }],
    [{ documentId: ID, fromPage: 0 }],
    [{ documentId: 'x', fromPage: 1 }],
  ])('rejects an invalid payload without retry: %j', async (data) => {
    const { worker, batches } = setup();
    await expect(worker.handle(job(data))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(batches).toEqual([]);
  });

  it('marks the document as failed once the batch has used all its attempts', async () => {
    const { worker, failed } = setup();
    await worker.onFinalFailure(job({ documentId: ID, fromPage: 21 }));
    await worker.onFinalFailure(job({ nonsense: true }));
    expect(failed).toEqual([ID]);
  });

  it('does not start a worker when job workers are disabled', () => {
    const { worker } = setup();
    worker.onApplicationBootstrap();
    return expect(worker.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
