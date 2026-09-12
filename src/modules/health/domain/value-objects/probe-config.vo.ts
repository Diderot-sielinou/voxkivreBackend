/**
 * Cible à sonder. Union discriminée : si `configured: false`, le service
 * apparaît dans le rapport en `NOT_CONFIGURED` sans tentative réseau — le
 * type rend impossible d'avoir un host sans port ou inversement.
 */
export type ProbeConfig =
  | {
      readonly name: string;
      readonly configured: true;
      readonly host: string;
      readonly port: number;
    }
  | { readonly name: string; readonly configured: false };
