import { type DeleteAccountUseCase } from '../../application/use-cases/delete-account.use-case';
import { type AccountActivityPort } from '../../domain/ports/account-activity.port';
import { type UserAccountsPort } from '../../domain/ports/user-accounts.port';

/** Codes de sortie lus par l'opérateur (et par SSM, qui les remonte). */
export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, REFUSED: 3 } as const;

export const USAGE = 'usage: account:delete <email | +237…> [--yes]';

export interface AccountDeleteArgs {
  readonly contact: string;
  /** Sans `--yes` : simple vérification, rien n'est supprimé. */
  readonly confirmed: boolean;
}

export interface AccountDeleteDeps {
  readonly accounts: UserAccountsPort;
  readonly activity: AccountActivityPort;
  readonly deleteAccount: DeleteAccountUseCase;
  /** Sortie de l'opérateur. Jamais l'e-mail ni le numéro (PII). */
  readonly print: (line: Readonly<Record<string, unknown>>) => void;
}

export function parseAccountDeleteArgs(argv: readonly string[]): AccountDeleteArgs | null {
  const confirmed = argv.includes('--yes');
  const rest = argv.filter((arg) => arg !== '--yes');
  if (rest.length !== 1 || rest[0].startsWith('-')) return null;
  const contact = rest[0].trim();
  const looksLikeContact = contact.includes('@') || /^\+\d{8,15}$/.test(contact);
  return looksLikeContact ? { contact, confirmed } : null;
}

/**
 * Suppression d'un compte sur demande reçue hors de l'app (ADR-0023) :
 * l'opérateur a vérifié l'identité du demandeur. D'abord sans `--yes` pour
 * voir le compte trouvé et ce qui bloquerait, puis avec `--yes`.
 */
export async function runAccountDelete(
  args: AccountDeleteArgs,
  deps: AccountDeleteDeps,
): Promise<number> {
  const userId = await deps.accounts.findIdByContact(args.contact);
  if (userId === null) {
    deps.print({ outcome: 'not_found' });
    return EXIT.REFUSED;
  }

  if (!args.confirmed) {
    const blocker = await deps.activity.findBlocker(userId);
    deps.print({ outcome: 'dry_run', userId, blocker, next: 'rerun with --yes to delete' });
    return EXIT.OK;
  }

  const result = await deps.deleteAccount.execute({ userId, requestedBy: 'operator' });
  if (result.isErr()) {
    deps.print({
      outcome: 'refused',
      userId,
      code: result.error.code,
      details: result.error.details,
    });
    return EXIT.REFUSED;
  }
  deps.print({ outcome: 'deleted', userId, fileCount: result.value.fileCount });
  return EXIT.OK;
}
