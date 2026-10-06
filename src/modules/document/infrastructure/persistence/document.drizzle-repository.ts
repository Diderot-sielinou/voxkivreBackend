import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type Document } from '../../domain/entities/document.entity';
import {
  type AbandonedUpload,
  type DocumentPagePosition,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { documents } from './schema/document.schema';

/** Colonnes explicites (jamais `SELECT *`, performance-rules.md). */
const DOCUMENT_COLUMNS = {
  id: documents.id,
  ownerId: documents.ownerId,
  title: documents.title,
  status: documents.status,
  sizeBytes: documents.sizeBytes,
  sourceKey: documents.sourceKey,
  rightsAttestedAt: documents.rightsAttestedAt,
  rightsAttestationVersion: documents.rightsAttestationVersion,
  uploadedAt: documents.uploadedAt,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

type DocumentRow = {
  [K in keyof typeof DOCUMENT_COLUMNS]: (typeof documents.$inferSelect)[K];
};

/**
 * Reconstitue l'entité depuis une ligne. Les valeurs ont été validées par le
 * domaine à l'écriture et la contrainte `CHECK` garde `status` : on marque
 * les types sans revalider.
 */
function toDocument(row: DocumentRow): Document {
  return {
    id: DocumentId.of(row.id),
    ownerId: OwnerId.of(row.ownerId),
    title: row.title as DocumentTitle,
    status: row.status === 'uploaded' ? DocumentStatus.UPLOADED : DocumentStatus.AWAITING_UPLOAD,
    sizeBytes: row.sizeBytes as DocumentSize,
    sourceKey: row.sourceKey,
    rightsAttestedAt: row.rightsAttestedAt,
    rightsAttestationVersion: row.rightsAttestationVersion,
    uploadedAt: row.uploadedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class DrizzleDocumentRepository implements DocumentRepositoryPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async insert(document: Document): Promise<void> {
    await this.db.insert(documents).values({
      id: document.id,
      ownerId: document.ownerId,
      title: document.title,
      status: document.status,
      sizeBytes: document.sizeBytes,
      sourceKey: document.sourceKey,
      rightsAttestedAt: document.rightsAttestedAt,
      rightsAttestationVersion: document.rightsAttestationVersion,
      uploadedAt: document.uploadedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });
  }

  async findByIdForOwner(id: DocumentId, ownerId: OwnerId): Promise<Document | null> {
    const rows = await this.db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
      .limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toDocument(row);
  }

  async markUploaded(id: DocumentId, uploadedAt: Date): Promise<void> {
    await this.db
      .update(documents)
      .set({ status: DocumentStatus.UPLOADED, uploadedAt, updatedAt: uploadedAt })
      .where(and(eq(documents.id, id), eq(documents.status, DocumentStatus.AWAITING_UPLOAD)));
  }

  async listUploadedByOwner(
    ownerId: OwnerId,
    after: DocumentPagePosition | null,
    limit: number,
  ): Promise<readonly Document[]> {
    const ownerFilter = and(
      eq(documents.ownerId, ownerId),
      eq(documents.status, DocumentStatus.UPLOADED),
    );
    // Keyset `(created_at, id) < (after.createdAt, after.id)` en ordre DESC.
    const where =
      after === null
        ? ownerFilter
        : and(
            ownerFilter,
            or(
              lt(documents.createdAt, after.createdAt),
              and(eq(documents.createdAt, after.createdAt), lt(documents.id, after.id)),
            ),
          );
    const rows = await this.db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(where)
      .orderBy(desc(documents.createdAt), desc(documents.id))
      .limit(limit);
    return rows.map((row) => toDocument(row));
  }

  async findAbandonedUploads(
    createdBefore: Date,
    limit: number,
  ): Promise<readonly AbandonedUpload[]> {
    const rows = await this.db
      .select({ id: documents.id, sourceKey: documents.sourceKey })
      .from(documents)
      .where(
        and(
          eq(documents.status, DocumentStatus.AWAITING_UPLOAD),
          lt(documents.createdAt, createdBefore),
        ),
      )
      .orderBy(documents.createdAt)
      .limit(limit);
    return rows.map((row) => ({ id: DocumentId.of(row.id), sourceKey: row.sourceKey }));
  }

  async deleteIfAwaitingUpload(id: DocumentId): Promise<boolean> {
    const deleted = await this.db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.status, DocumentStatus.AWAITING_UPLOAD)))
      .returning({ id: documents.id });
    return deleted.length > 0;
  }
}
