/**
 * Destination lisible dans les logs sans être une donnée personnelle
 * exploitable (security-baseline : pas de PII) : `+2376••••••12`,
 * `a•••@gmail.com`.
 */
export function maskDestination(destination: string): string {
  const at = destination.indexOf('@');
  if (at > 0) return `${destination.slice(0, 1)}•••${destination.slice(at)}`;
  if (destination.length <= 7) return '•'.repeat(destination.length);
  return `${destination.slice(0, 5)}${'•'.repeat(destination.length - 7)}${destination.slice(-2)}`;
}
