/**
 * Marque-page (RF-27, ADR-0028), ancré au **texte du document**, jamais à
 * une conversion : il survit à un changement de voix ou de texte.
 */
export interface Bookmark {
  /** UUID créé par l'appareil (création hors ligne). */
  readonly id: string;
  readonly ownerId: string;
  readonly documentId: string;
  /** 1-based. */
  readonly pageNumber: number;
  /** Index du mot dans la page (0 = premier mot), à la création. */
  readonly wordIndex: number;
  /** Quelques mots à partir de l'ancrage, pour le retrouver si le texte change. */
  readonly excerpt: string;
  readonly note: string;
  readonly createdAt: Date;
  /** Instant (appareil) de la dernière modification ou suppression : « le plus récent gagne ». */
  readonly updatedAt: Date;
  /** Trace de suppression : `null` si actif. */
  readonly deletedAt: Date | null;
}

/** Où se trouve le marque-page dans le texte courant (ADR-0028 §4). */
export interface ResolvedAnchor {
  readonly wordIndex: number;
  /** Ancrage incertain : extrait introuvable, placé au mot le plus proche. */
  readonly needsReview: boolean;
}
