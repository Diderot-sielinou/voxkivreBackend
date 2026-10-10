import {
  ConversionState,
  DocumentState,
  LibraryItemStatus,
} from '../value-objects/library-item-status.vo';

import { deriveLibraryStatus, progressPercent } from './library-status';

const ready = { state: ConversionState.READY, playableWordCount: 1000 };
const processing = { state: ConversionState.PROCESSING, playableWordCount: 300 };
const failed = { state: ConversionState.FAILED, playableWordCount: 0 };
const at = (wordIndex: number) => ({ wordIndex });

describe('deriveLibraryStatus', () => {
  it('follows the document while its text is not ready', () => {
    expect(deriveLibraryStatus(DocumentState.PROCESSING, null, null)).toBe(
      LibraryItemStatus.PROCESSING,
    );
    expect(deriveLibraryStatus(DocumentState.FAILED, null, null)).toBe(LibraryItemStatus.FAILED);
  });

  it('then follows the conversion when nothing has been read', () => {
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, null, null)).toBe(
      LibraryItemStatus.NOT_CONVERTED,
    );
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, processing, null)).toBe(
      LibraryItemStatus.PROCESSING,
    );
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, failed, null)).toBe(
      LibraryItemStatus.FAILED,
    );
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, ready, null)).toBe(
      LibraryItemStatus.READY,
    );
  });

  it('is « to resume » once reading started, even while the rest is synthesized', () => {
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, processing, at(299))).toBe(
      LibraryItemStatus.IN_PROGRESS,
    );
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, ready, at(10))).toBe(
      LibraryItemStatus.IN_PROGRESS,
    );
  });

  it('is finished with less than 2 % of the words left, on a complete conversion only', () => {
    // 1000 mots : 980 lus → 20 restants = 2 % → pas encore ; 981 lus → terminé.
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, ready, at(979))).toBe(
      LibraryItemStatus.IN_PROGRESS,
    );
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, ready, at(980))).toBe(
      LibraryItemStatus.FINISHED,
    );
    expect(deriveLibraryStatus(DocumentState.TEXT_READY, processing, at(299))).not.toBe(
      LibraryItemStatus.FINISHED,
    );
  });
});

describe('progressPercent', () => {
  it('is known only for a complete conversion with a position', () => {
    expect(progressPercent(at(499), ready)).toBe(50);
    expect(progressPercent(at(999), ready)).toBe(100);
    expect(progressPercent(null, ready)).toBeNull();
    expect(progressPercent(at(10), processing)).toBeNull();
    expect(progressPercent(at(0), null)).toBeNull();
  });
});
