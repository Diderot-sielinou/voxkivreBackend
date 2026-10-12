import { type Bookmark } from '../entities/bookmark.entity';

export const BOOKMARK_REPOSITORY = Symbol('BookmarkRepository');

/** Une modification datée par l'appareil : la plus récente gagne (ADR-0028 §2–§3). */
export type BookmarkChange =
  | { readonly kind: 'edit'; readonly note: string; readonly at: Date }
  | { readonly kind: 'delete'; readonly at: Date };

export interface BookmarkRepositoryPort {
  findById(id: string): Promise<Bookmark | null>;

  /** Marque-pages actifs (sans trace de suppression) d'un document. */
  countActive(documentId: string, ownerId: string): Promise<number>;

  /** Actifs, triés par page puis mot. */
  listActive(documentId: string, ownerId: string): Promise<readonly Bookmark[]>;

  /** Crée le marque-page ; `false` si l'identifiant existe déjà (création concurrente). */
  insert(bookmark: Bookmark): Promise<boolean>;

  /**
   * Applique la modification **seulement si elle est plus récente** que la
   * dernière connue (une instruction, sans course). Une édition plus récente
   * qu'une suppression rétablit le marque-page. Rend l'état retenu, ou
   * `null` si l'identifiant n'existe pas pour ce propriétaire et ce document.
   */
  applyChange(
    id: string,
    ownerId: string,
    documentId: string,
    change: BookmarkChange,
  ): Promise<Bookmark | null>;
}
