import * as vscode from 'vscode';
import type { ConnectionService } from '../services/connectionService';
import type { IConnectionConfig } from '../../shared/types/database';
import { DatabaseType } from '../../shared/types/database';

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly connection: IConnectionConfig,
    public readonly isConnected: boolean
  ) {
    super(connection.name, vscode.TreeItemCollapsibleState.None);

    this.description = this.getDescription();
    this.tooltip = this.getTooltip();
    this.iconPath = this.getIcon();
    this.contextValue = isConnected ? 'connection-connected' : 'connection-disconnected';

    this.command = {
      command: isConnected ? 'dbViewer.disconnect' : 'dbViewer.connect',
      title: isConnected ? 'Disconnect' : 'Connect',
      arguments: [this]
    };
  }

  private getDescription(): string {
    const parts: string[] = [this.getDatabaseTypeLabel()];

    if (this.connection.host) {
      parts.push(this.connection.host);
    } else if (this.connection.filename) {
      parts.push(this.connection.filename.split('/').pop() || '');
    }

    if (this.isConnected) {
      parts.push('(connected)');
    }

    return parts.join(' - ');
  }

  private getTooltip(): string {
    const lines = [
      `Name: ${this.connection.name}`,
      `Type: ${this.getDatabaseTypeLabel()}`
    ];

    if (this.connection.host) {
      lines.push(`Host: ${this.connection.host}`);
      if (this.connection.port) {
        lines.push(`Port: ${this.connection.port}`);
      }
    }

    if (this.connection.database) {
      lines.push(`Database: ${this.connection.database}`);
    }

    if (this.connection.filename) {
      lines.push(`File: ${this.connection.filename}`);
    }

    lines.push(`Status: ${this.isConnected ? 'Connected' : 'Disconnected'}`);

    return lines.join('\n');
  }

  private getDatabaseTypeLabel(): string {
    switch (this.connection.type) {
      case DatabaseType.SQLite:
        return 'SQLite';
      case DatabaseType.PostgreSQL:
        return 'PostgreSQL';
      case DatabaseType.MySQL:
        return 'MySQL';
      case DatabaseType.MSSQL:
        return 'SQL Server';
      case DatabaseType.MongoDB:
        return 'MongoDB';
      default:
        return 'Unknown';
    }
  }

  private getIcon(): vscode.ThemeIcon {
    if (this.isConnected) {
      return new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.green'));
    }
    return new vscode.ThemeIcon('database');
  }
}

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private connectionService: ConnectionService) {
    connectionService.onConnectionsChanged(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ConnectionTreeItem[] {
    const connections = this.connectionService.getAllConnections();

    if (connections.length === 0) {
      return [];
    }

    return connections.map(
      conn => new ConnectionTreeItem(conn, this.connectionService.isConnected(conn.id))
    );
  }

  getParent(): vscode.ProviderResult<ConnectionTreeItem> {
    return null;
  }
}
