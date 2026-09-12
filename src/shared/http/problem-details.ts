/**
 * RFC 7807 — Problem Details for HTTP APIs.
 *
 * Champs étendus (conventionnels) :
 * - `code`      : code stable du domain error, machine-readable (le client
 *                 mobile branche ses messages dessus, pas sur `detail`)
 * - `details`   : payload structuré attaché à l'erreur
 * - `requestId` : corrélation logs ↔ client
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  details?: Readonly<Record<string, unknown>>;
  requestId?: string;
}
