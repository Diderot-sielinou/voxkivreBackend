export const USER_ACCOUNTS = Symbol('UserAccounts');

/** Écriture sur la ligne `user` (la lecture passe par `UserQueryPort`). */
export interface UserAccountsPort {
  /**
   * Identifiant du compte par e-mail ou numéro E.164 (`+…`), pour une
   * demande reçue hors de l'app ; `null` si aucun compte.
   */
  findIdByContact(contact: string): Promise<string | null>;

  /**
   * Verrouille l'utilisateur jusqu'à la fin de la transaction `tx` : une
   * conversion ou un paiement ne peut plus s'y rattacher. `false` s'il
   * n'existe plus.
   */
  lockForDeletion(userId: string, tx: unknown): Promise<boolean>;

  /** Supprime l'utilisateur ; la cascade emporte ses données (ADR-0023 §1). */
  delete(userId: string, tx: unknown): Promise<void>;
}
