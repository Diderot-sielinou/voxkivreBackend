import { DocumentId } from '../value-objects/document-id.vo';
import { type DocumentSize } from '../value-objects/document-size.vo';
import { DocumentStatus } from '../value-objects/document-status.vo';
import { type DocumentTitle } from '../value-objects/document-title.vo';
import { OwnerId } from '../value-objects/owner-id.vo';

import {
  hasPdfSignature,
  markUploaded,
  newDocumentAwaitingUpload,
  RIGHTS_ATTESTATION_VERSION,
  sourceKeyFor,
} from './document.entity';

const NOW = new Date('2026-10-06T10:00:00Z');
const ID = DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b');
const OWNER = OwnerId.of('user-1');

describe('document entity', () => {
  it('builds a deterministic storage key that never contains a client filename', () => {
    expect(sourceKeyFor(OWNER, ID)).toBe(`documents/user-1/${ID}/source.pdf`);
  });

  it('encodes the owner id so it cannot escape its prefix', () => {
    expect(sourceKeyFor(OwnerId.of('../evil'), ID)).toBe(`documents/..%2Fevil/${ID}/source.pdf`);
  });

  it('creates an awaiting_upload document with a versioned rights attestation', () => {
    const doc = newDocumentAwaitingUpload({
      id: ID,
      ownerId: OWNER,
      title: 'Titre' as DocumentTitle,
      sizeBytes: 42 as DocumentSize,
      now: NOW,
    });
    expect(doc).toEqual({
      id: ID,
      ownerId: OWNER,
      title: 'Titre',
      status: DocumentStatus.AWAITING_UPLOAD,
      sizeBytes: 42,
      sourceKey: sourceKeyFor(OWNER, ID),
      rightsAttestedAt: NOW,
      rightsAttestationVersion: RIGHTS_ATTESTATION_VERSION,
      uploadedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('marks a document uploaded, and is idempotent once uploaded', () => {
    const doc = newDocumentAwaitingUpload({
      id: ID,
      ownerId: OWNER,
      title: 'Titre' as DocumentTitle,
      sizeBytes: 42 as DocumentSize,
      now: NOW,
    });
    const later = new Date('2026-10-06T10:05:00Z');
    const uploaded = markUploaded(doc, later);
    expect(uploaded).toMatchObject({
      status: DocumentStatus.UPLOADED,
      uploadedAt: later,
      updatedAt: later,
    });
    expect(markUploaded(uploaded, new Date('2026-10-07T00:00:00Z'))).toBe(uploaded);
  });

  it.each([
    ['%PDF-1.7', true],
    ['%PDF-', true],
    ['%PDF', false],
    ['<html>', false],
    ['', false],
  ])('hasPdfSignature(%j) → %p', (content, expected) => {
    expect(hasPdfSignature(new TextEncoder().encode(content))).toBe(expected);
  });
});
