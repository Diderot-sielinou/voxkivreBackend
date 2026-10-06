import { Injectable } from '@nestjs/common';

import {
  DocumentTextReader,
  type DocumentTextState,
} from '@/modules/document/application/services/document-text-reader.service';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';

import {
  type DocumentTextSourcePort,
  type SourcePage,
  type SourceText,
} from '../../domain/ports/document-text-source.port';

function toSource(state: DocumentTextState): SourceText {
  return {
    documentId: state.documentId,
    ownerId: state.ownerId,
    textReady: state.status === DocumentStatus.TEXT_READY,
    status: state.status,
    charCount: state.charCount ?? 0,
    textRevision: state.textRevision,
  };
}

/**
 * Port `DocumentTextSource` branché sur le service exporté par
 * `DocumentModule` (jamais sur son repository, dependency-injection.md).
 */
@Injectable()
export class DocumentModuleTextSource implements DocumentTextSourcePort {
  constructor(private readonly reader: DocumentTextReader) {}

  async findForOwner(documentId: string, ownerId: string): Promise<SourceText | null> {
    const state = await this.reader.findForOwner(documentId, ownerId);
    return state === null ? null : toSource(state);
  }

  async findById(documentId: string): Promise<SourceText | null> {
    const state = await this.reader.findById(documentId);
    return state === null ? null : toSource(state);
  }

  readPages(documentId: string): Promise<readonly SourcePage[]> {
    return this.reader.readPages(documentId);
  }
}
