import { ExtractionFailureReason } from '../value-objects/document-status.vo';

import {
  checkOcrAllowance,
  firstMissingOcrPage,
  OCR_BATCH_PAGES,
  OCR_FREE_PAGES_PER_MONTH,
  OCR_MAX_PAGES_PER_DOCUMENT,
  OCR_REVIEW_CONFIDENCE,
  ocrBatchEnd,
  requiresReview,
  startOfOcrMonth,
} from './ocr';

describe('ocrBatchEnd', () => {
  it('covers OCR_BATCH_PAGES pages, never past the last page', () => {
    expect(ocrBatchEnd(1, 300)).toBe(OCR_BATCH_PAGES);
    expect(ocrBatchEnd(21, 25)).toBe(25);
    expect(ocrBatchEnd(3, 3)).toBe(3);
  });
});

describe('firstMissingOcrPage', () => {
  it('finds the first page not recognised yet, in any order', () => {
    expect(firstMissingOcrPage([], 3)).toBe(1);
    expect(firstMissingOcrPage([3, 1], 3)).toBe(2);
    expect(firstMissingOcrPage([2, 3, 1], 3)).toBeNull();
  });
});

describe('startOfOcrMonth', () => {
  it('is the first day of the UTC calendar month', () => {
    expect(startOfOcrMonth(new Date('2026-10-31T23:30:00Z'))).toEqual(
      new Date('2026-10-01T00:00:00Z'),
    );
  });
});

describe('checkOcrAllowance', () => {
  it('refuses a scan over the page limit, even with a pass', () => {
    expect(
      checkOcrAllowance({
        pageCount: OCR_MAX_PAGES_PER_DOCUMENT + 1,
        pagesUsedThisMonth: 0,
        hasPaidAccess: true,
      }),
    ).toBe(ExtractionFailureReason.OCR_TOO_MANY_PAGES);
    expect(
      checkOcrAllowance({
        pageCount: OCR_MAX_PAGES_PER_DOCUMENT,
        pagesUsedThisMonth: 10_000,
        hasPaidAccess: true,
      }),
    ).toBeNull();
  });

  it('caps a free account to the monthly pages, the whole scan or nothing', () => {
    const used = OCR_FREE_PAGES_PER_MONTH - 20;
    expect(
      checkOcrAllowance({ pageCount: 20, pagesUsedThisMonth: used, hasPaidAccess: false }),
    ).toBeNull();
    expect(
      checkOcrAllowance({ pageCount: 21, pagesUsedThisMonth: used, hasPaidAccess: false }),
    ).toBe(ExtractionFailureReason.OCR_QUOTA_EXCEEDED);
  });
});

describe('requiresReview', () => {
  it('asks for a review as soon as one page is under the threshold', () => {
    expect(requiresReview([0.97, OCR_REVIEW_CONFIDENCE, null])).toBe(false);
    expect(requiresReview([0.97, OCR_REVIEW_CONFIDENCE - 0.01])).toBe(true);
    expect(requiresReview([])).toBe(false);
  });
});
