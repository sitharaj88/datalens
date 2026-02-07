import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import type { IConnectionConfig } from '../../shared/types/database';
import { AdapterFactory } from '../database/factory';
import type { IDatabaseAdapter } from '../database/interfaces/IAdapter';

const CONNECTIONS_KEY = 'dbViewer.connections';

export class ConnectionService {
  private context: vscode.ExtensionContext;
  private connections: Map<string, IConnectionConfig> = new Map();
  private activeConnections: Set<string> = new Set();
  private _onConnectionsChanged = new vscode.EventEmitter<void>();

  readonly onConnectionsChanged = this._onConnectionsChanged.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadConnections();
  }

  private loadConnections(): void {
    const stored = this.context.globalState.get<IConnectionConfig[]>(CONNECTIONS_KEY, []);
    this.connections.clear();
    for (const config of stored) {
      this.connections.set(config.id, config);
    }
  }

  private async saveConnections(): Promise<void> {
    const configs = Array.from(this.connections.values()).map(config => ({
      ...config,
      password: undefined
    }));
    await this.context.globalState.update(CONNECTIONS_KEY, configs);
  }

  async addConnection(config: Omit<IConnectionConfig, 'id'>): Promise<IConnectionConfig> {
    const id = uuidv4();
    const fullConfig: IConnectionConfig = { ...config, id };

    if (fullConfig.password) {
      await this.context.secrets.store(`dbViewer.password.${id}`, fullConfig.password);
    }

    this.connections.set(id, fullConfig);
    await this.saveConnections();
    this._onConnectionsChanged.fire();

    return fullConfig;
  }

  async updateConnection(config: IConnectionConfig): Promise<void> {
    if (!this.connections.has(config.id)) {
      throw new Error(`Connection not found: ${config.id}`);
    }

    if (config.password) {
      await this.context.secrets.store(`dbViewer.password.${config.id}`, config.password);
    }

    this.connections.set(config.id, config);
    await this.saveConnections();
    this._onConnectionsChanged.fire();
  }

  async removeConnection(connectionId: string): Promise<void> {
    if (this.activeConnections.has(connectionId)) {
      await this.disconnect(connectionId);
    }

    await this.context.secrets.delete(`dbViewer.password.${connectionId}`);
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

  isConnected(connectionId: string): boolean {
    return this.activeConnections.has(connectionId);
  }

  async connect(connectionId: string): Promise<IDatabaseAdapter> {
    const config = this.connections.get(connectionId);
    if (!config) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    const password = await this.context.secrets.get(`dbViewer.password.${connectionId}`);
    const fullConfig: IConnectionConfig = { ...config, password };

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
