import {
  markUploaded,
  newDocumentAwaitingUpload,
} from '@/modules/document/domain/entities/document.entity';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { type DocumentSize } from '@/modules/document/domain/value-objects/document-size.vo';
import { type DocumentTitle } from '@/modules/document/domain/value-objects/document-title.vo';
import { OwnerId } from '@/modules/document/domain/value-objects/owner-id.vo';

import {
  toDocumentListResponseDto,
  toDocumentPageTextDto,
  toDocumentResponseDto,
  toDocumentUploadResponseDto,
  toUploadPartsResponseDto,
} from './document.mapper';

const CREATED = new Date('2026-10-06T10:00:00.000Z');
const doc = newDocumentAwaitingUpload({
  id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b'),
  ownerId: OwnerId.of('user-1'),
  title: 'Titre' as DocumentTitle,
  sizeBytes: 42 as DocumentSize,
  now: CREATED,
});

describe('document mappers', () => {
  it('exposes ISO dates and never the owner id nor the storage key', () => {
    const dto = toDocumentResponseDto(doc);
    expect(dto).toEqual({
      id: doc.id,
      title: 'Titre',
      status: 'awaiting_upload',
      sizeBytes: 42,
      rightsAttestedAt: '2026-10-06T10:00:00.000Z',
      rightsAttestationVersion: 'v1',
      uploadedAt: null,
      pageCount: null,
      charCount: null,
      extractionError: null,
      extractionMethod: null,
      ocrProgress: null,
      reviewRequired: false,
      reviewedAt: null,
      createdAt: '2026-10-06T10:00:00.000Z',
      updatedAt: '2026-10-06T10:00:00.000Z',
    });
    expect(Object.keys(dto)).not.toContain('sourceKey');
    expect(Object.keys(dto)).not.toContain('ownerId');
  });

  it('exposes the OCR progress only when it is known, and the review state', () => {
    const scan = {
      ...doc,
      status: 'extracting' as const,
      extractionMethod: 'ocr' as const,
      ocrPageCount: 25,
    };
    expect(toDocumentResponseDto(scan, 10)).toMatchObject({
      extractionMethod: 'ocr',
      ocrProgress: { done: 10, total: 25 },
    });
    expect(toDocumentResponseDto(scan).ocrProgress).toBeNull();
    const reviewed = {
      ...doc,
      reviewRequired: true,
      reviewedAt: new Date('2026-10-12T09:00:00.000Z'),
    };
    expect(toDocumentResponseDto(reviewed)).toMatchObject({
      reviewRequired: true,
      reviewedAt: '2026-10-12T09:00:00.000Z',
    });
  });

  it('exposes the OCR confidence of a page', () => {
    expect(
      toDocumentPageTextDto({
        documentId: doc.id,
        pageNumber: 1,
        text: 'x',
        charCount: 1,
        setAside: null,
        ocrConfidence: 0.71,
        updatedAt: CREATED,
      }).confidence,
    ).toBeCloseTo(0.71);
  });

  it('maps uploadedAt once uploaded', () => {
    const uploaded = markUploaded(doc, new Date('2026-10-06T10:05:00.000Z'));
    expect(toDocumentResponseDto(uploaded).uploadedAt).toBe('2026-10-06T10:05:00.000Z');
  });

  it('maps an upload ticket', () => {
    const dto = toDocumentUploadResponseDto({
      document: doc,
      upload: {
        url: 'https://s/x',
        method: 'PUT',
        headers: { 'content-length': '42' },
        expiresAt: new Date('2026-10-06T10:15:00.000Z'),
      },
      multipart: null,
    });
    expect(dto.multipart).toBeNull();
    expect(dto.upload).toEqual({
      url: 'https://s/x',
      method: 'PUT',
      headers: { 'content-length': '42' },
      expiresAt: '2026-10-06T10:15:00.000Z',
    });
    expect(dto.document.id).toBe(doc.id);
  });

  it('maps a multipart ticket and the part instructions', () => {
    const dto = toDocumentUploadResponseDto({
      document: doc,
      upload: null,
      multipart: { partSize: 5_242_880, partCount: 3 },
    });
    expect(dto.upload).toBeNull();
    expect(dto.multipart).toEqual({ partSize: 5_242_880, partCount: 3 });

    expect(
      toUploadPartsResponseDto({
        receivedParts: [1],
        parts: [{ partNumber: 2, url: 'https://s/p2', method: 'PUT', headers: { a: 'b' } }],
        expiresAt: new Date('2026-10-06T10:15:00.000Z'),
      }),
    ).toEqual({
      receivedParts: [1],
      parts: [{ partNumber: 2, url: 'https://s/p2', method: 'PUT', headers: { a: 'b' } }],
      expiresAt: '2026-10-06T10:15:00.000Z',
    });
  });

  it('maps a page', () => {
    expect(toDocumentListResponseDto({ items: [doc], nextCursor: 'c' })).toMatchObject({
      items: [{ id: doc.id }],
      nextCursor: 'c',
    });
  });
});
