import { type DocumentUploadTicket } from '@/modules/document/application/use-cases/request-document-upload.use-case';
import { type Document } from '@/modules/document/domain/entities/document.entity';
import { type CursorPage } from '@/shared/kernel';

import { type DocumentPageResponseDto } from '../dto/document-page-response.dto';
import { type DocumentResponseDto } from '../dto/document-response.dto';
import { type DocumentUploadResponseDto } from '../dto/document-upload-response.dto';

export function toDocumentResponseDto(document: Document): DocumentResponseDto {
  return {
    id: document.id,
    title: document.title,
    status: document.status,
    sizeBytes: document.sizeBytes,
    rightsAttestedAt: document.rightsAttestedAt.toISOString(),
    rightsAttestationVersion: document.rightsAttestationVersion,
    uploadedAt: document.uploadedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function toDocumentUploadResponseDto(
  ticket: DocumentUploadTicket,
): DocumentUploadResponseDto {
  return {
    document: toDocumentResponseDto(ticket.document),
    upload: {
      url: ticket.upload.url,
      method: ticket.upload.method,
      headers: { ...ticket.upload.headers },
      expiresAt: ticket.upload.expiresAt.toISOString(),
    },
  };
}

export function toDocumentPageResponseDto(page: CursorPage<Document>): DocumentPageResponseDto {
  return {
    items: page.items.map((d) => toDocumentResponseDto(d)),
    nextCursor: page.nextCursor,
  };
}
