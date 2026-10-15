/**
 * Port du stockage objet durable (ADR-0007) : PDF sources importés, puis
 * audio et WebVTT générés (DEC-04, RF-18, RNF-10).
 *
 * Contrat d'erreur : une panne du fournisseur (réseau, 5xx, credentials)
 * est levée par l'adapter sous forme de `StorageUnavailableError`
 * (`INFRASTRUCTURE_*` → 503, RNF-11). Un objet absent n'est PAS une panne :
 * `head` renvoie `null`.
 *
 * Changer de fournisseur (R2 → S3 → autre) = un nouvel adapter, zéro
 * changement dans les use-cases (RNF-17).
 */
export const OBJECT_STORAGE = Symbol('ObjectStorage');

export interface PresignPutInput {
  /** Clé objet déterministe, construite par le domaine (jamais par le client). */
  readonly key: string;
  readonly contentType: string;
  /**
   * Taille exacte attendue, **signée** dans l'URL : le fournisseur refuse un
   * upload d'une autre taille (R2 ne supporte pas les POST policies qui
   * permettraient un `content-length-range`).
   */
  readonly contentLength: number;
  readonly expiresInSeconds: number;
}

/** Instruction d'upload direct renvoyée au mobile. */
export interface PresignedUpload {
  readonly url: string;
  readonly method: 'PUT';
  /** En-têtes que le client DOIT envoyer tels quels (ils sont signés). */
  readonly headers: Readonly<Record<string, string>>;
}

/** Morceau d'un envoi multipart à signer (ADR-0029). */
export interface PresignPartInput {
  readonly key: string;
  readonly uploadId: string;
  /** De 1 à 10 000 (S3). */
  readonly partNumber: number;
  /** Taille exacte du morceau, signée comme pour `presignPut`. */
  readonly contentLength: number;
  readonly expiresInSeconds: number;
}

/** Morceau déjà reçu par le fournisseur. */
export interface UploadedPart {
  readonly partNumber: number;
  readonly sizeBytes: number;
  /** Empreinte rendue par le fournisseur, nécessaire à l'assemblage. */
  readonly etag: string;
}

export interface ObjectMetadata {
  readonly sizeBytes: number;
  readonly contentType: string | null;
}

export interface ObjectStoragePort {
  /** Signe une URL d'upload direct. Calcul local : aucun appel réseau. */
  presignPut(input: PresignPutInput): Promise<PresignedUpload>;

  /**
   * Signe une URL de téléchargement direct (GET) : le mobile récupère
   * l'audio sans passer par l'API. Calcul local : aucun appel réseau.
   */
  presignGet(key: string, expiresInSeconds: number): Promise<string>;

  /** Ouvre un envoi par morceaux (ADR-0029) ; renvoie son identifiant. */
  createMultipartUpload(key: string, contentType: string): Promise<string>;

  /** Signe l'URL d'un morceau. Calcul local : aucun appel réseau. */
  presignUploadPart(input: PresignPartInput): Promise<PresignedUpload>;

  /**
   * Morceaux déjà reçus, ou `null` si l'envoi n'existe plus (déjà assemblé
   * ou annulé).
   */
  listUploadedParts(key: string, uploadId: string): Promise<readonly UploadedPart[] | null>;

  /** Assemble les morceaux en un seul objet sous `key`. */
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly UploadedPart[],
  ): Promise<void>;

  /** Annule l'envoi et libère ses morceaux ; sans effet s'il n'existe plus. */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;

  /** Métadonnées d'un objet, ou `null` s'il n'existe pas. */
  head(key: string): Promise<ObjectMetadata | null>;

  /** Contenu complet de l'objet, ou `null` s'il n'existe pas. */
  get(key: string): Promise<Uint8Array | null>;

  /** Lit les octets `[start, endInclusive]` (ex. signature de format). */
  readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>;

  /**
   * Écrit un objet produit par le serveur (audio, marques de synthèse).
   * Écrase un objet existant : avec des clés déterministes, une relance
   * réécrit au lieu de dupliquer.
   */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;

  /** Supprime l'objet. Idempotent : supprimer un objet absent réussit. */
  delete(key: string): Promise<void>;
}
