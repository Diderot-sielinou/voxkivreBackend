import * as net from 'node:net';

import { Injectable } from '@nestjs/common';

import {
  type ServiceConnectivityPort,
  type ServiceConnectivityResult,
} from '@/modules/health/domain/ports/service-connectivity.port';

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Adapter TCP : ouvre une socket vers host:port puis la ferme aussitôt.
 * Suffisant pour "le service est-il là" sans dépendre d'un client Postgres
 * ou Redis (et sans consommer une connexion du pool).
 */
@Injectable()
export class TcpServiceConnectivityAdapter implements ServiceConnectivityPort {
  probe(
    host: string,
    port: number,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ServiceConnectivityResult> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);

      socket.once('connect', () => {
        socket.destroy();
        resolve({ reachable: true });
      });

      socket.once('timeout', () => {
        socket.destroy();
        resolve({ reachable: false, reason: 'timeout' });
      });

      socket.once('error', (err: Error) => {
        socket.destroy();
        resolve({ reachable: false, reason: err.message });
      });

      socket.connect(port, host);
    });
  }
}
