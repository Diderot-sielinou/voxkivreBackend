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
