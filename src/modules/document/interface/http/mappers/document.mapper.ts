import { type UploadPartsTicket } from '@/modules/document/application/use-cases/prepare-upload-parts.use-case';
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
import {
  type DocumentUploadResponseDto,
  type UploadPartsResponseDto,
} from '../dto/document-upload-response.dto';

/** `ocrPagesDone` : pages reconnues pendant un OCR, connu seulement en lecture unitaire. */
export function toDocumentResponseDto(
  document: Document,
  ocrPagesDone: number | null = null,
): DocumentResponseDto {
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
    extractionMethod: document.extractionMethod,
    ocrProgress:
      ocrPagesDone === null || document.ocrPageCount === null
        ? null
        : { done: ocrPagesDone, total: document.ocrPageCount },
    reviewRequired: document.reviewRequired,
    reviewedAt: document.reviewedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function toDocumentUploadResponseDto(
  ticket: DocumentUploadTicket,
): DocumentUploadResponseDto {
  const { upload, multipart } = ticket;
  return {
    document: toDocumentResponseDto(ticket.document),
    upload:
      upload === null
        ? null
        : {
            url: upload.url,
            method: upload.method,
            headers: { ...upload.headers },
            expiresAt: upload.expiresAt.toISOString(),
          },
    multipart:
      multipart === null ? null : { partSize: multipart.partSize, partCount: multipart.partCount },
  };
}

export function toUploadPartsResponseDto(ticket: UploadPartsTicket): UploadPartsResponseDto {
  return {
    receivedParts: [...ticket.receivedParts],
    parts: ticket.parts.map((part) => ({
      partNumber: part.partNumber,
      url: part.url,
      method: part.method,
      headers: { ...part.headers },
    })),
    expiresAt: ticket.expiresAt.toISOString(),
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
    confidence: page.ocrConfidence,
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
