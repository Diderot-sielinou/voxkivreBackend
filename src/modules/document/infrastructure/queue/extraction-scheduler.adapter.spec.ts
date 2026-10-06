import { Logger } from '@nestjs/common';

import { type EnqueueJobInput, type JobQueuePort } from '@/shared/queue/job-queue.port';
import { QueueUnavailableError } from '@/shared/queue/queue.errors';

import { DocumentId } from '../../domain/value-objects/document-id.vo';

import { QueueExtractionScheduler } from './extraction-scheduler.adapter';

const ID = DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b');

describe('QueueExtractionScheduler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('enqueues extract-text with a deterministic job id and only the document id', async () => {
    const jobs: EnqueueJobInput[] = [];
    const queue: JobQueuePort = {
      enqueue: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    };
    expect(await new QueueExtractionScheduler(queue).schedule(ID)).toBe(true);
    expect(jobs).toEqual([
      {
        queue: 'document',
        name: 'extract-text',
        jobId: `extract-text-${ID}`,
        payload: { documentId: ID },
        attempts: 3,
      },
    ]);
  });

  it('never throws: a queue outage is logged and reported as not scheduled', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const queue: JobQueuePort = {
      enqueue: () => Promise.reject(new QueueUnavailableError('redis down')),
    };
    expect(await new QueueExtractionScheduler(queue).schedule(ID)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
