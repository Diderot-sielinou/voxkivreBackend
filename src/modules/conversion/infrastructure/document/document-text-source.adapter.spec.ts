import { DocumentTextReader } from '@/modules/document/application/services/document-text-reader.service';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';

import { InMemoryDocumentRepository } from '../../../../../test/support/fakes';

import { DocumentModuleTextSource } from './document-text-source.adapter';

const ID = '01a11019-f2e7-7014-8369-af25cb7e0f0b';
const NOW = new Date('2026-10-06T10:00:00Z');

describe('DocumentModuleTextSource', () => {
  it('translates the document text state for the conversion', async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.insert({
      id: DocumentId.of(ID),
      ownerId: 'alice' as never,
      title: 'Livre' as never,
      status: DocumentStatus.EXTRACTING,
      sizeBytes: 10 as never,
      sourceKey: 'k',
      rightsAttestedAt: NOW,
      rightsAttestationVersion: 'v1',
      uploadedAt: NOW,
      pageCount: null,
      charCount: null,
      textRevision: 0,
      extractionError: null,
      sourceDeletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const source = new DocumentModuleTextSource(new DocumentTextReader(repo));
    expect(await source.findForOwner(ID, 'alice')).toEqual({
      documentId: ID,
      ownerId: 'alice',
      textReady: false,
      status: 'extracting',
      charCount: 0,
      textRevision: 0,
    });
    await repo.completeExtraction(
      DocumentId.of(ID),
      [{ pageNumber: 1, text: 'Bonjour.', charCount: 8, setAside: [] }],
      8,
      NOW,
    );
    expect(await source.findById(ID)).toMatchObject({
      textReady: true,
      charCount: 8,
      textRevision: 1,
    });
    expect(await source.findForOwner(ID, 'bob')).toBeNull();
    expect(await source.findById('01a11019-f2e7-7014-8369-000000000000')).toBeNull();
    expect(await source.readPages(ID)).toEqual([{ pageNumber: 1, text: 'Bonjour.' }]);
  });
});
