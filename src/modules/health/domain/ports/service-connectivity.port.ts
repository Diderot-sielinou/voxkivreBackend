export const SERVICE_CONNECTIVITY = Symbol('ServiceConnectivity');

export interface ServiceConnectivityResult {
  readonly reachable: boolean;
  readonly reason?: string;
}

/**
 * Port : "peut-on joindre host:port ?". Le domain ne sait pas si c'est du
 * TCP, un ping Redis ou un `SELECT 1` — c'est l'adapter qui décide.
 */
export interface ServiceConnectivityPort {
  /**
   * Sonde la connectivité d'un service. Ne throw jamais — l'échec se
   * traduit par `{ reachable: false, reason }`.
   */
  probe(host: string, port: number, timeoutMs?: number): Promise<ServiceConnectivityResult>;
}
