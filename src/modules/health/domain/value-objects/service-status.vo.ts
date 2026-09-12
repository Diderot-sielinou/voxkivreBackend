/**
 * État d'un service externe tel que vu par la sonde.
 * - ACTIVE          : joignable
 * - INACTIVE        : configuré mais injoignable (raison attachée)
 * - NOT_CONFIGURED  : absent de l'env (dev sans Redis par ex.) — pas d'appel réseau
 */
export const ServiceStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
} as const;

export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];
