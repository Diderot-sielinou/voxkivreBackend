import { type DocumentId } from '../value-objects/document-id.vo';
import { type DocumentSize } from '../value-objects/document-size.vo';
import { DocumentStatus, type ExtractionFailureReason } from '../value-objects/document-status.vo';
import { type DocumentTitle } from '../value-objects/document-title.vo';
import { type OwnerId } from '../value-objects/owner-id.vo';

/** Seul format importable au MVP (RF-01). */
export const PDF_CONTENT_TYPE = 'application/pdf';

/** Tout PDF commence par ces 5 octets (ISO 32000-1 §7.5.2). */
export const PDF_SIGNATURE = '%PDF-';

/**
 * Version du texte d'attestation de droits présenté au mobile (RNF-24).
 * À incrémenter quand le texte juridique change : chaque document garde la
 * version que l'utilisateur a réellement acceptée.
 */
export const RIGHTS_ATTESTATION_VERSION = 'v1';

/**
 * Document importé par un utilisateur. Le domaine ne connaît que des
 * métadonnées : les octets vivent dans le stockage objet sous `sourceKey`.
 */
export interface Document {
  readonly id: DocumentId;
  readonly ownerId: OwnerId;
  readonly title: DocumentTitle;
  readonly status: DocumentStatus;
  /** Taille déclarée à la création, imposée par l'URL d'upload signée. */
  readonly sizeBytes: DocumentSize;
  readonly sourceKey: string;
  readonly rightsAttestedAt: Date;
  readonly rightsAttestationVersion: string;
  readonly uploadedAt: Date | null;
  /** Renseignés quand le texte est prêt (`text_ready`). */
  readonly pageCount: number | null;
  /** Total de caractères du texte : base du quota (RF-24) et du coût TTS. */
  readonly charCount: number | null;
  readonly extractionError: ExtractionFailureReason | null;
  /** Le PDF source a été supprimé du stockage (CdC §8). */
  readonly sourceDeletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Clé objet **déterministe**, jamais dérivée du nom de fichier client : pas
 * de path traversal, pas de donnée personnelle dans la clé, et un ré-upload
 * écrase au lieu de dupliquer. Le préfixe propriétaire permet de purger
 * toutes les données d'un compte d'un coup.
 */
export function sourceKeyFor(ownerId: OwnerId, documentId: DocumentId): string {
  return `documents/${encodeURIComponent(ownerId)}/${documentId}/source.pdf`;
}

export function newDocumentAwaitingUpload(input: {
  readonly id: DocumentId;
  readonly ownerId: OwnerId;
  readonly title: DocumentTitle;
  readonly sizeBytes: DocumentSize;
  readonly now: Date;
}): Document {
  return {
    id: input.id,
    ownerId: input.ownerId,
    title: input.title,
    status: DocumentStatus.AWAITING_UPLOAD,
    sizeBytes: input.sizeBytes,
    sourceKey: sourceKeyFor(input.ownerId, input.id),
    rightsAttestedAt: input.now,
    rightsAttestationVersion: RIGHTS_ATTESTATION_VERSION,
    uploadedAt: null,
    pageCount: null,
    charCount: null,
    extractionError: null,
    sourceDeletedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Transition `awaiting_upload → uploaded`. Idempotente sur un document déjà importé. */
export function markUploaded(document: Document, now: Date): Document {
  if (document.status === DocumentStatus.UPLOADED) return document;
  return { ...document, status: DocumentStatus.UPLOADED, uploadedAt: now, updatedAt: now };
}

/** `true` si les premiers octets sont la signature PDF. */
export function hasPdfSignature(firstBytes: Uint8Array): boolean {
  if (firstBytes.length < PDF_SIGNATURE.length) return false;
  for (let i = 0; i < PDF_SIGNATURE.length; i += 1) {
    if (firstBytes[i] !== PDF_SIGNATURE.codePointAt(i)) return false;
  }
  return true;
}

/** Le texte n'est extrait qu'une fois : ces statuts sont terminaux pour l'extraction. */
export function isExtractionSettled(document: Pick<Document, 'status'>): boolean {
  return (
    document.status === DocumentStatus.TEXT_READY ||
    document.status === DocumentStatus.EXTRACTION_FAILED
  );
}
