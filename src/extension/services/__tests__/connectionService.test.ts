import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionService } from '../connectionService';
import { __setConfig, __setInputBoxResult } from '../../../../test/vscode-mock';
import { DatabaseType, type IConnectionConfig } from '../../../shared/types/database';

/** In-memory ExtensionContext double exposing globalState + secrets. */
function makeContext() {
  const globalStore = new Map<string, unknown>();
  const secretStore = new Map<string, string>();
  return {
    context: {
      globalState: {
        get: (key: string, def?: unknown) => (globalStore.has(key) ? globalStore.get(key) : def),
        update: async (key: string, value: unknown) => { globalStore.set(key, value); },
      },
      secrets: {
        get: async (key: string) => (secretStore.has(key) ? secretStore.get(key) : undefined),
        store: async (key: string, value: string) => { secretStore.set(key, value); },
        delete: async (key: string) => { secretStore.delete(key); },
      },
    } as any,
    globalStore,
    secretStore,
  };
}

const baseConfig: Omit<IConnectionConfig, 'id'> = {
  name: 'prod-db',
  type: DatabaseType.PostgreSQL,
  host: 'db.example.com',
  port: 5432,
  database: 'app',
  username: 'admin',
  password: 'super-secret',
  sshEnabled: true,
  sshHost: 'bastion.example.com',
  sshPassword: 'ssh-secret',
};

describe('ConnectionService credential storage', () => {
  beforeEach(() => {
    __setConfig({ 'security.storePasswords': true });
    __setInputBoxResult(undefined);
  });

  it('never persists secret fields to globalState', async () => {
    const { context, globalStore } = makeContext();
    const svc = new ConnectionService(context);
    await svc.ready;

    await svc.addConnection(baseConfig);

    const persisted = globalStore.get('dbViewer.connections') as IConnectionConfig[];
    expect(persisted).toHaveLength(1);
    const stored = persisted[0];
    expect(stored.password).toBeUndefined();
    expect(stored.sshPassword).toBeUndefined();
    // Non-secret metadata is still present.
    expect(stored.host).toBe('db.example.com');
    expect(stored.username).toBe('admin');
  });

  it('stores secrets in SecretStorage and re-hydrates them', async () => {
    const { context, secretStore } = makeContext();
    const svc = new ConnectionService(context);
    await svc.ready;

    const added = await svc.addConnection(baseConfig);

    expect(secretStore.get(`dbViewer.password.${added.id}`)).toBe('super-secret');
    expect(secretStore.get(`dbViewer.secret.${added.id}.sshPassword`)).toBe('ssh-secret');

    const hydrated = await svc.getConnectionWithSecrets(added.id);
    expect(hydrated?.password).toBe('super-secret');
    expect(hydrated?.sshPassword).toBe('ssh-secret');
  });

  it('does not return secrets from the public getter', async () => {
    const { context } = makeContext();
    const svc = new ConnectionService(context);
    await svc.ready;

    const added = await svc.addConnection(baseConfig);
    const pub = svc.getConnection(added.id);
    expect(pub?.password).toBeUndefined();
    expect(pub?.sshPassword).toBeUndefined();
  });

  it('migrates legacy plaintext secrets out of globalState on startup', async () => {
    const { context, globalStore, secretStore } = makeContext();
    // Seed globalState as an old version would have: secrets in plaintext.
    globalStore.set('dbViewer.connections', [
      { id: 'legacy-1', name: 'old', type: DatabaseType.MySQL, database: 'd', sshPassword: 'leaked', awsSecretAccessKey: 'leaked-aws' },
    ]);

    const svc = new ConnectionService(context);
    await svc.ready;

    // Secrets moved into SecretStorage.
    expect(secretStore.get('dbViewer.secret.legacy-1.sshPassword')).toBe('leaked');
    expect(secretStore.get('dbViewer.secret.legacy-1.awsSecretAccessKey')).toBe('leaked-aws');

    // And stripped from globalState.
    const persisted = globalStore.get('dbViewer.connections') as IConnectionConfig[];
    expect(persisted[0].sshPassword).toBeUndefined();
    expect((persisted[0] as Record<string, unknown>).awsSecretAccessKey).toBeUndefined();
  });

  it('does not persist the password when storePasswords is disabled', async () => {
    __setConfig({ 'security.storePasswords': false });
    const { context, secretStore } = makeContext();
    const svc = new ConnectionService(context);
    await svc.ready;

    const added = await svc.addConnection(baseConfig);

    // Interactive credentials are not stored...
    expect(secretStore.get(`dbViewer.password.${added.id}`)).toBeUndefined();
    expect(secretStore.get(`dbViewer.secret.${added.id}.sshPassword`)).toBeUndefined();
  });
});
