import { ConversionCatalog } from '@/modules/conversion/application/services/conversion-catalog.service';
import { newQueuedConversion } from '@/modules/conversion/domain/entities/conversion.entity';
import { ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import { ConversionStatus } from '@/modules/conversion/domain/value-objects/conversion-status.vo';
import { type VoiceId } from '@/modules/conversion/domain/voices';

import { InMemoryConversionRepository } from '../../../../../test/support/fakes';
import { ConversionState } from '../../domain/value-objects/library-item-status.vo';

import { ConversionModuleLibraryConversions } from './library-conversions.adapter';

const AT = new Date('2026-10-10T10:00:00Z');

describe('ConversionModuleLibraryConversions', () => {
  it('translates conversion statuses into library states', async () => {
    const repo = new InMemoryConversionRepository();
    const statuses: [string, ConversionStatus][] = [
      ['d1', ConversionStatus.READY],
      ['d2', ConversionStatus.FAILED],
      ['d3', ConversionStatus.SYNTHESIZED],
    ];
    for (const [documentId, status] of statuses) {
      await repo.insert({
        ...newQueuedConversion({
          id: ConversionId.of(`c-${documentId}`),
          ownerId: 'alice',
          documentId,
          voiceId: 'fr-f1' as VoiceId,
          textRevision: 1,
          reservedChars: 10,
          now: AT,
        }),
        status,
      });
    }
    const adapter = new ConversionModuleLibraryConversions(new ConversionCatalog(repo));

    const byDocument = await adapter.forDocuments('alice', ['d1', 'd2', 'd3']);
    expect([...byDocument.values()].map((c) => [c.documentId, c.state])).toEqual([
      ['d1', ConversionState.READY],
      ['d2', ConversionState.FAILED],
      ['d3', ConversionState.PROCESSING],
    ]);
    const one = await adapter.findForOwner('c-d1', 'alice');
    expect(one?.state).toBe(ConversionState.READY);
    expect(await adapter.findForOwner('c-d1', 'bob')).toBeNull();
    const cleanup = await adapter.cleanupForDocument('d3', null);
    expect(cleanup.running).toBe(true);
  });
});
