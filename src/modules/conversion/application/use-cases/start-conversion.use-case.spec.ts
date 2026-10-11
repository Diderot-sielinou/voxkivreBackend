import { QuotaExceededError } from '@/modules/billing/domain/errors/quota-exceeded.error';
import { Units } from '@/modules/billing/domain/value-objects/units.vo';

import {
  FakeConversionJobs,
  FakeDocumentTextSource,
  FakeQuota,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryConversionRepository,
} from '../../../../../test/support/fakes';
import { CONVERSION_ERROR_CODES } from '../../domain/errors/error-codes';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';

import { StartConversionUseCase } from './start-conversion.use-case';

const DOC = '01a11019-f2e7-7014-8369-af25cb7e0f0b';

function setup(overrides: { textReady?: boolean; charCount?: number } = {}) {
  const repo = new InMemoryConversionRepository();
  const documents = new FakeDocumentTextSource();
  documents.add(
    {
      documentId: DOC,
      ownerId: 'alice',
      textReady: overrides.textReady ?? true,
      status: overrides.textReady === false ? 'extracting' : 'text_ready',
      charCount: overrides.charCount ?? 1200,
      textRevision: 3,
    },
    [{ pageNumber: 1, text: 'Bonjour.' }],
  );
  const quota = new FakeQuota();
  const jobs = new FakeConversionJobs();
  const uow = new ImmediateUnitOfWork();
  const clock = new FixedClock(new Date('2026-10-06T10:00:00Z'));
  const sut = new StartConversionUseCase(repo, documents, quota, jobs, uow, clock);
  return { sut, repo, quota, jobs, uow };
}

describe('StartConversionUseCase', () => {
  it('reserves the whole text, creates a queued conversion and schedules its preparation', async () => {
    const { sut, repo, quota, jobs, uow } = setup();
    const result = await sut.execute({ ownerId: 'alice', documentId: DOC, voiceId: 'fr-m1' });
    const conversion = result.value;
    expect(conversion).toMatchObject({
      ownerId: 'alice',
      documentId: DOC,
      voiceId: 'fr-m1',
      textRevision: 3,
      status: ConversionStatus.QUEUED,
      reservedChars: 1200,
    });
    expect(quota.reserved).toEqual([
      { reservationId: conversion.id, userId: 'alice', chars: 1200, voiceTier: 'natural' },
    ]);
    expect(repo.rows.get(conversion.id)).toEqual(conversion);
    expect(jobs.preparations).toEqual([conversion.id]);
    expect(uow.calls).toBe(1);
  });

  it('uses the default voice, a standard one the free tier can pay for', async () => {
    const { sut, quota } = setup();
    const result = await sut.execute({ ownerId: 'alice', documentId: DOC });
    expect(result.value.voiceId).toBe('fr-f2');
    expect(quota.reserved).toMatchObject([{ voiceTier: 'standard' }]);
  });

  it('returns the active conversion for the same text and voice without a new debit', async () => {
    const { sut, quota } = setup();
    const first = await sut.execute({ ownerId: 'alice', documentId: DOC });
    const second = await sut.execute({ ownerId: 'alice', documentId: DOC });
    expect(second.value.id).toBe(first.value.id);
    expect(quota.reserved).toHaveLength(1);
  });

  it('re-schedules a conversion still queued (queue down at launch)', async () => {
    const { sut, jobs } = setup();
    jobs.available = false;
    const first = await sut.execute({ ownerId: 'alice', documentId: DOC });
    expect(first.isOk()).toBe(true);
    jobs.available = true;
    await sut.execute({ ownerId: 'alice', documentId: DOC });
    expect(jobs.preparations).toEqual([first.value.id]);
  });

  it('returns the winner when an identical launch wins the race (unique index)', async () => {
    const { sut, repo, quota } = setup();
    const winner = await sut.execute({ ownerId: 'alice', documentId: DOC });
    // Simule la course : `findActive` ne voit rien, l'insertion est refusée.
    const findActive = jest
      .spyOn(repo, 'findActive')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner.value);
    const loser = await sut.execute({ ownerId: 'alice', documentId: DOC });
    expect(loser.value.id).toBe(winner.value.id);
    expect(findActive).toHaveBeenCalledTimes(2);
    // Dans la vraie base, la réservation du perdant est annulée avec sa transaction.
    expect(quota.reserved).toHaveLength(2);
  });

  it('creates nothing when the quota refuses', async () => {
    const { sut, repo, quota, jobs } = setup();
    quota.rejectWith = new QuotaExceededError({
      requested: 1200,
      usable: 10,
      tier: 'standard',
      available: { free: Units.of(10), pass: Units.of(0), credits: Units.of(0) },
      period: '2026-10',
    });
    const result = await sut.execute({ ownerId: 'alice', documentId: DOC });
    expect(result.error.code).toBe('QUOTA_EXCEEDED');
    expect(repo.rows.size).toBe(0);
    expect(jobs.preparations).toEqual([]);
  });

  it.each([
    [{ ownerId: 'alice', documentId: DOC, voiceId: 'Lea' }, 'INVALID_VOICE'],
    [{ ownerId: 'bob', documentId: DOC }, 'DOCUMENT_NOT_FOUND'],
  ])('rejects %o with %s', async (input, code) => {
    const { sut } = setup();
    const result = await sut.execute(input);
    expect(result.error.code).toBe(code);
  });

  it('rejects a document whose text is not ready (409) or empty (422)', async () => {
    const notReady = await setup({ textReady: false }).sut.execute({
      ownerId: 'alice',
      documentId: DOC,
    });
    expect(notReady.error).toMatchObject({
      code: CONVERSION_ERROR_CODES.DOCUMENT_TEXT_NOT_READY,
      details: { status: 'extracting' },
    });
    const empty = await setup({ charCount: 0 }).sut.execute({ ownerId: 'alice', documentId: DOC });
    expect(empty.error.code).toBe(CONVERSION_ERROR_CODES.INVALID_CONVERSION_TEXT);
  });

  it('lets an unexpected persistence error propagate', async () => {
    const { sut, repo } = setup();
    jest.spyOn(repo, 'insert').mockRejectedValueOnce(new Error('db down'));
    await expect(sut.execute({ ownerId: 'alice', documentId: DOC })).rejects.toThrow('db down');
  });
});
