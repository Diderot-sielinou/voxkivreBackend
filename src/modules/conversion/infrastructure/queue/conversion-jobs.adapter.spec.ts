import { Logger } from '@nestjs/common';

import { type EnqueueJobInput, type JobQueuePort } from '@/shared/queue/job-queue.port';
import { QueueUnavailableError } from '@/shared/queue/queue.errors';

import { ConversionId } from '../../domain/value-objects/conversion-id.vo';

import { QueueConversionJobs } from './conversion-jobs.adapter';
import { MAX_JOB_PRIORITY } from './conversion-jobs.constants';

const ID = ConversionId.of('01a11019-f2e7-7014-8369-af25cb7e0f0c');

function recordingQueue() {
  const jobs: EnqueueJobInput[] = [];
  const queue: JobQueuePort = {
    enqueue: (job) => {
      jobs.push(job);
      return Promise.resolve();
    },
  };
  return { jobs, queue };
}

const downQueue: JobQueuePort = {
  enqueue: () => Promise.reject(new QueueUnavailableError('redis down')),
};

describe('QueueConversionJobs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('enqueues the preparation with a deterministic job id and only the conversion id', async () => {
    const { jobs, queue } = recordingQueue();
    expect(await new QueueConversionJobs(queue).schedulePreparation(ID)).toBe(true);
    expect(jobs).toEqual([
      {
        queue: 'conversion-prepare',
        name: 'prepare-conversion',
        jobId: `prepare-conversion-${ID}`,
        payload: { conversionId: ID },
        attempts: 3,
      },
    ]);
  });

  it('never throws on preparation: a queue outage is logged and left to the sweeper', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    expect(await new QueueConversionJobs(downQueue).schedulePreparation(ID)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('enqueues one synthesis per segment, first segments first (RF-15)', async () => {
    const { jobs, queue } = recordingQueue();
    await new QueueConversionJobs(queue).scheduleSynthesis(ID, [0, 1, MAX_JOB_PRIORITY + 5]);
    expect(jobs.map((j) => [j.jobId, j.priority, j.attempts])).toEqual([
      [`synthesize-segment-${ID}-0`, 1, 5],
      [`synthesize-segment-${ID}-1`, 2, 5],
      [`synthesize-segment-${ID}-${String(MAX_JOB_PRIORITY + 5)}`, MAX_JOB_PRIORITY, 5],
    ]);
    expect(jobs[1].payload).toEqual({ conversionId: ID, segmentIndex: 1 });
  });

  it('enqueues one assembly per part, with a distinct job id for sweeper retries', async () => {
    const { jobs, queue } = recordingQueue();
    const adapter = new QueueConversionJobs(queue);
    await adapter.scheduleAssembly(ID, 2);
    await adapter.scheduleAssembly(ID, 2, 'sweep-42');
    expect(jobs).toEqual([
      {
        queue: 'conversion-assembly',
        name: 'assemble-part',
        jobId: `assemble-part-${ID}-2`,
        payload: { conversionId: ID, partIndex: 2 },
        attempts: 3,
      },
      expect.objectContaining({ jobId: `assemble-part-${ID}-2-sweep-42` }),
    ]);
  });

  it('lets a synthesis enqueue failure propagate (the calling job is retried)', async () => {
    await expect(
      new QueueConversionJobs(downQueue).scheduleSynthesis(ID, [0]),
    ).rejects.toBeInstanceOf(QueueUnavailableError);
  });
});
