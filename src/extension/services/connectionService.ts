import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import type { IConnectionConfig } from '../../shared/types/database';
import { AdapterFactory } from '../database/factory';
import type { IDatabaseAdapter } from '../database/interfaces/IAdapter';

const CONNECTIONS_KEY = 'dbViewer.connections';

/**
 * Fields that hold credentials/secrets. These must NEVER be persisted to
 * globalState (which is plaintext on disk). They are stored in VS Code
 * SecretStorage instead and re-hydrated on demand when connecting.
 */
const SECRET_FIELDS = [
  'password',
  'sshPassword',
  'sshPassphrase',
  'sshPrivateKey',
  'awsSecretAccessKey',
  'serviceAccountKey',
] as const;

type SecretField = (typeof SECRET_FIELDS)[number];

export class ConnectionService {
  private context: vscode.ExtensionContext;
  /** In-memory registry holds PUBLIC config only (no secret fields). */
  private connections: Map<string, IConnectionConfig> = new Map();
  private activeConnections: Set<string> = new Set();
  private _onConnectionsChanged = new vscode.EventEmitter<void>();

  /** Resolves once any legacy plaintext secrets have been migrated. */
  readonly ready: Promise<void>;

  readonly onConnectionsChanged = this._onConnectionsChanged.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadConnections();
    this.ready = this.migrateLegacySecrets();
  }

  /** Storage key for a given secret field. Password keeps its legacy key for backward compatibility. */
  private secretStorageKey(connectionId: string, field: SecretField): string {
    return field === 'password'
      ? `dbViewer.password.${connectionId}`
      : `dbViewer.secret.${connectionId}.${field}`;
  }

  private loadConnections(): void {
    const stored = this.context.globalState.get<IConnectionConfig[]>(CONNECTIONS_KEY, []);
    this.connections.clear();
    for (const config of stored) {
      // Defensive: never keep secret fields in the in-memory public registry.
      this.connections.set(config.id, this.stripSecrets(config));
    }
  }

  /** Returns a copy of the config with all secret fields removed. */
  private stripSecrets(config: IConnectionConfig): IConnectionConfig {
    const clean: IConnectionConfig = { ...config };
    for (const field of SECRET_FIELDS) {
      delete (clean as unknown as Record<string, unknown>)[field];
    }
    return clean;
  }

  private shouldStorePasswords(): boolean {
    return vscode.workspace.getConfiguration('dbViewer').get<boolean>('security.storePasswords', true);
  }

  /** Persists any secret fields present on `config` into SecretStorage. */
  private async persistSecrets(config: Partial<IConnectionConfig> & { id: string }): Promise<void> {
    const storePasswords = this.shouldStorePasswords();
    for (const field of SECRET_FIELDS) {
      // When password storage is disabled, never persist the interactive
      // password fields — they are prompted for at connect time instead.
      if (!storePasswords && (field === 'password' || field === 'sshPassword')) {
        await this.context.secrets.delete(this.secretStorageKey(config.id, field));
        continue;
      }
      const value = (config as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length > 0) {
        await this.context.secrets.store(this.secretStorageKey(config.id, field), value);
      }
    }
  }

  /** Removes all secrets for a connection from SecretStorage. */
  private async deleteSecrets(connectionId: string): Promise<void> {
    for (const field of SECRET_FIELDS) {
      await this.context.secrets.delete(this.secretStorageKey(connectionId, field));
    }
  }

  /** Returns a copy of the stored config with secret fields re-hydrated from SecretStorage. */
  private async hydrateSecrets(config: IConnectionConfig): Promise<IConnectionConfig> {
    const hydrated: IConnectionConfig = { ...config };
    for (const field of SECRET_FIELDS) {
      const value = await this.context.secrets.get(this.secretStorageKey(config.id, field));
      if (value !== undefined) {
        (hydrated as unknown as Record<string, unknown>)[field] = value;
      }
    }
    return hydrated;
  }

  /**
   * One-time migration: older versions of DataLens persisted SSH/AWS/GCP
   * secrets to globalState in plaintext. Move any such values into
   * SecretStorage and re-save the stripped config.
   */
  private async migrateLegacySecrets(): Promise<void> {
    const stored = this.context.globalState.get<IConnectionConfig[]>(CONNECTIONS_KEY, []);
    let migrated = false;

    for (const config of stored) {
      for (const field of SECRET_FIELDS) {
        const value = (config as unknown as Record<string, unknown>)[field];
        if (typeof value === 'string' && value.length > 0) {
          await this.context.secrets.store(this.secretStorageKey(config.id, field), value);
          migrated = true;
        }
      }
    }

    // Re-save strips every secret field from globalState.
    if (migrated) {
      await this.saveConnections();
    }
  }

  private async saveConnections(): Promise<void> {
    const configs = Array.from(this.connections.values()).map(config => this.stripSecrets(config));
    await this.context.globalState.update(CONNECTIONS_KEY, configs);
  }

  async addConnection(config: Omit<IConnectionConfig, 'id'>): Promise<IConnectionConfig> {
    const id = uuidv4();
    const fullConfig: IConnectionConfig = { ...config, id };

    await this.persistSecrets(fullConfig);

    this.connections.set(id, this.stripSecrets(fullConfig));
    await this.saveConnections();
    this._onConnectionsChanged.fire();

    return this.stripSecrets(fullConfig);
  }

  async updateConnection(config: IConnectionConfig): Promise<void> {
    if (!this.connections.has(config.id)) {
      throw new Error(`Connection not found: ${config.id}`);
    }

    // Only stores secret fields that are actually present on the incoming
    // config; omitted fields leave existing secrets untouched.
    await this.persistSecrets(config);

    this.connections.set(config.id, this.stripSecrets(config));
    await this.saveConnections();
    this._onConnectionsChanged.fire();
  }

  async removeConnection(connectionId: string): Promise<void> {
    if (this.activeConnections.has(connectionId)) {
      await this.disconnect(connectionId);
    }

    await this.deleteSecrets(connectionId);
    this.connections.delete(connectionId);
    AdapterFactory.remove(connectionId);

    await this.saveConnections();
    this._onConnectionsChanged.fire();
  }

  getConnection(connectionId: string): IConnectionConfig | undefined {
    return this.connections.get(connectionId);
  }

  getAllConnections(): IConnectionConfig[] {
    return Array.from(this.connections.values());
  }

  /** Returns the connection with secret fields re-hydrated from SecretStorage. */
  async getConnectionWithSecrets(connectionId: string): Promise<IConnectionConfig | undefined> {
    await this.ready;
    const config = this.connections.get(connectionId);
    if (!config) {
      return undefined;
    }
    return this.hydrateSecrets(config);
  }

  isConnected(connectionId: string): boolean {
    return this.activeConnections.has(connectionId);
  }

  async connect(connectionId: string): Promise<IDatabaseAdapter> {
    await this.ready;
    const config = this.connections.get(connectionId);
    if (!config) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    const fullConfig = await this.hydrateSecrets(config);

    // If password storage is disabled (or the password was never stored) but the
    // connection authenticates with a username, prompt for it for this session only.
    if (fullConfig.username && !fullConfig.password) {
      const entered = await vscode.window.showInputBox({
        password: true,
        ignoreFocusOut: true,
        prompt: `Password for ${fullConfig.name}`,
        placeHolder: 'Leave blank to attempt connecting without a password',
      });
      if (entered) {
        fullConfig.password = entered;
      }
    }

    const adapter = AdapterFactory.create(fullConfig);

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    this.activeConnections.add(connectionId);
    this._onConnectionsChanged.fire();

    return adapter;
  }

  async disconnect(connectionId: string): Promise<void> {
    const adapter = AdapterFactory.get(connectionId);
    if (adapter?.isConnected()) {
      await adapter.disconnect();
    }

    this.activeConnections.delete(connectionId);
    this._onConnectionsChanged.fire();
  }

  getAdapter(connectionId: string): IDatabaseAdapter | undefined {
    return AdapterFactory.get(connectionId);
  }

  async testConnection(config: Omit<IConnectionConfig, 'id'>): Promise<boolean> {
    const tempConfig: IConnectionConfig = { ...config, id: 'test-' + uuidv4() };
    const adapter = AdapterFactory.create(tempConfig);

    try {
      return await adapter.testConnection();
    } finally {
      AdapterFactory.remove(tempConfig.id);
    }
  }

  async dispose(): Promise<void> {
    await AdapterFactory.disconnectAll();
    this._onConnectionsChanged.dispose();
  }
}
