import { type Brand } from '@/shared/kernel';

/**
 * Période de quota : un mois civil **UTC**, au format `YYYY-MM`. Le
 * Cameroun est à UTC+1 sans heure d'été : le compteur se remet à zéro le
 * 1er du mois à 1 h du matin, heure de Douala — écart accepté pour garder une
 * seule règle, indépendante du fuseau du serveur.
 */
export type QuotaPeriod = Brand<string, 'QuotaPeriod'>;

export const QuotaPeriod = {
  at(date: Date): QuotaPeriod {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${String(date.getUTCFullYear())}-${month}` as QuotaPeriod;
  },
} as const;
