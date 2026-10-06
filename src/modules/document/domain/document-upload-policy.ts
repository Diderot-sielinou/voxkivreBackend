/**
 * Règles d'import, injectées dans les use-cases (le plafond vient de l'env,
 * les durées sont des conventions produit — cf. ADR-0007).
 */
export const DOCUMENT_UPLOAD_POLICY = Symbol('DocumentUploadPolicy');

export interface DocumentUploadPolicy {
  /** `DOCUMENT_MAX_SIZE_BYTES`. */
  readonly maxSizeBytes: number;
  /** Validité de l'URL d'upload signée. */
  readonly uploadUrlTtlSeconds: number;
  /**
   * Délai après lequel un document jamais confirmé est purgé (fichier
   * compris). C'est aussi la fenêtre dont dispose le mobile pour rejouer une
   * confirmation perdue sur un réseau instable.
   */
  readonly abandonedUploadTtlSeconds: number;
}

/** 15 min : assez pour un PDF de 50 Mo en 3G, assez court pour limiter la réutilisation. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** 24 h. */
export const ABANDONED_UPLOAD_TTL_SECONDS = 24 * 60 * 60;
