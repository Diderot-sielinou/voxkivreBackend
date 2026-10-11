import { type DocumentUploadTicket } from '@/modules/document/application/use-cases/request-document-upload.use-case';
import { type DocumentPage } from '@/modules/document/domain/entities/document-page.entity';
import { type Document } from '@/modules/document/domain/entities/document.entity';
import { type CursorPage } from '@/shared/kernel';

import { type DocumentListResponseDto } from '../dto/document-list-response.dto';
import {
  type DocumentPagesResponseDto,
  type DocumentPageTextDto,
} from '../dto/document-pages-response.dto';
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
    pageCount: document.pageCount,
    charCount: document.charCount,
    extractionError: document.extractionError,
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

export function toDocumentListResponseDto(page: CursorPage<Document>): DocumentListResponseDto {
  return {
    items: page.items.map((d) => toDocumentResponseDto(d)),
    nextCursor: page.nextCursor,
  };
}

export function toDocumentPageTextDto(page: DocumentPage): DocumentPageTextDto {
  return {
    pageNumber: page.pageNumber,
    text: page.text,
    charCount: page.charCount,
    // Page extraite avant le nettoyage (ADR-0022) : rien n'a été mis de côté.
    setAside: (page.setAside ?? []).map((line) => ({ text: line.text, reason: line.reason })),
    updatedAt: page.updatedAt.toISOString(),
  };
}

export function toDocumentPagesResponseDto(
  page: CursorPage<DocumentPage>,
): DocumentPagesResponseDto {
  return {
    items: page.items.map((p) => toDocumentPageTextDto(p)),
    nextCursor: page.nextCursor,
  };
}
