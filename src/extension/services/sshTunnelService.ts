import * as net from 'net';
import type { IConnectionConfig } from '../../shared/types/database';

interface TunnelInfo {
  client: any;
  server: net.Server;
  localPort: number;
}

export class SSHTunnelService {
  private tunnels: Map<string, TunnelInfo> = new Map();

  async createTunnel(config: IConnectionConfig): Promise<number> {
    if (this.tunnels.has(config.id)) {
      const existing = this.tunnels.get(config.id)!;
      return existing.localPort;
    }

    const localPort = await this.getAvailablePort();
    const { Client } = require('ssh2');
    const sshClient = new Client();

    const connectConfig: Record<string, unknown> = {
      host: config.sshHost,
      port: config.sshPort ?? 22,
      username: config.sshUsername,
      password: config.sshPassword,
      privateKey: config.sshPrivateKey,
      passphrase: config.sshPassphrase,
    };

    const remoteHost = config.host ?? '127.0.0.1';
    const remotePort = config.port ?? 5432;

    return new Promise<number>((resolve, reject) => {
      const server = net.createServer((clientSocket) => {
        sshClient.forwardOut(
          '127.0.0.1',
          localPort,
          remoteHost,
          remotePort,
          (err, stream) => {
            if (err) {
              clientSocket.end();
              return;
            }

            clientSocket.pipe(stream).pipe(clientSocket);

            stream.on('close', () => {
              clientSocket.end();
            });

            clientSocket.on('close', () => {
              stream.end();
            });
          }
        );
      });

      sshClient.on('ready', () => {
        server.listen(localPort, '127.0.0.1', () => {
          this.tunnels.set(config.id, {
            client: sshClient,
            server,
            localPort,
          });
          resolve(localPort);
        });
      });

      sshClient.on('error', (err) => {
        server.close();
        reject(new Error(`SSH tunnel connection failed: ${err.message}`));
      });

      server.on('error', (err) => {
        sshClient.end();
        reject(new Error(`SSH tunnel server failed: ${err.message}`));
      });

      sshClient.connect(connectConfig);
    });
  }

  async closeTunnel(connectionId: string): Promise<void> {
    const tunnel = this.tunnels.get(connectionId);
    if (!tunnel) {
      return;
    }

    return new Promise<void>((resolve) => {
      tunnel.server.close(() => {
        tunnel.client.end();
        this.tunnels.delete(connectionId);
        resolve();
      });
    });
  }

  async closeAll(): Promise<void> {
    const connectionIds = Array.from(this.tunnels.keys());
    await Promise.all(connectionIds.map((id) => this.closeTunnel(id)));
  }

  private getAvailablePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address !== 'string') {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new Error('Failed to allocate port')));
        }
      });
      server.on('error', reject);
    });
  }
}
