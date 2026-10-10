import { Injectable } from '@nestjs/common';

import {
  ConversionCatalog,
  type ConversionOverview,
} from '@/modules/conversion/application/services/conversion-catalog.service';
import { ConversionStatus } from '@/modules/conversion/domain/value-objects/conversion-status.vo';

import {
  type DocumentConversionsCleanup,
  type LibraryConversion,
  type LibraryConversionsPort,
} from '../../domain/ports/library-conversions.port';
import { ConversionState } from '../../domain/value-objects/library-item-status.vo';

function stateOf(status: ConversionStatus): ConversionState {
  if (status === ConversionStatus.READY) return ConversionState.READY;
  if (status === ConversionStatus.FAILED) return ConversionState.FAILED;
  return ConversionState.PROCESSING;
}

function toLibraryConversion(overview: ConversionOverview): LibraryConversion {
  return {
    conversionId: overview.conversionId,
    documentId: overview.documentId,
    voiceId: overview.voiceId,
    status: overview.status,
    state: stateOf(overview.status),
    failureReason: overview.failureReason,
    partCount: overview.partCount,
    partsReady: overview.partsReady,
    playableWordCount: overview.playableWordCount,
    playableDurationMs: overview.playableDurationMs,
    completedAt: overview.completedAt,
  };
}

/** Port `LibraryConversions` branché sur le service exporté par `ConversionModule`. */
@Injectable()
export class ConversionModuleLibraryConversions implements LibraryConversionsPort {
  constructor(private readonly catalog: ConversionCatalog) {}

  async forDocuments(
    ownerId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, LibraryConversion>> {
    const overviews = await this.catalog.overviewsByDocument(ownerId, documentIds);
    return new Map(
      [...overviews].map(([documentId, overview]) => [documentId, toLibraryConversion(overview)]),
    );
  }

  async findForOwner(conversionId: string, ownerId: string): Promise<LibraryConversion | null> {
    const overview = await this.catalog.overviewForOwner(conversionId, ownerId);
    return overview === null ? null : toLibraryConversion(overview);
  }

  cleanupForDocument(documentId: string, tx: unknown): Promise<DocumentConversionsCleanup> {
    return this.catalog.cleanupForDocument(documentId, tx);
  }
}
