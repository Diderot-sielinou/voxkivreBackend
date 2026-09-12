import * as net from 'node:net';

import { TcpServiceConnectivityAdapter } from './tcp-service-connectivity.adapter';

async function listenOnEphemeralPort(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a non-null TCP address');
  }
  return { server, port: address.port };
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

describe('TcpServiceConnectivityAdapter', () => {
  const adapter = new TcpServiceConnectivityAdapter();

  it('reports reachable when the host:port accepts connections', async () => {
    const { server, port } = await listenOnEphemeralPort();
    try {
      await expect(adapter.probe('127.0.0.1', port)).resolves.toEqual({ reachable: true });
    } finally {
      await closeServer(server);
    }
  });

  it('reports unreachable with a reason when the port is closed', async () => {
    const { server, port } = await listenOnEphemeralPort();
    await closeServer(server);

    const result = await adapter.probe('127.0.0.1', port);

    expect(result.reachable).toBe(false);
    expect(result.reason).toEqual(expect.any(String));
  });
});
