import * as vscode from 'vscode';
import type { ConnectionService } from '../services/connectionService';
import type { ITable, IColumn, IIndex, IConnectionConfig, IStoredProcedure, ITrigger, IView, IUser } from '../../shared/types/database';
import { AdapterFactory } from '../database/factory';

type SchemaTreeItemType = 'database' | 'folder' | 'table' | 'column' | 'index' | 'view' | 'procedure' | 'trigger' | 'user';

export class SchemaTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly itemType: SchemaTreeItemType,
    public readonly connectionId: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly data?: ITable | IColumn | IIndex | IConnectionConfig | IStoredProcedure | ITrigger | IView | IUser,
    public readonly parentTable?: string
  ) {
    super(label, collapsibleState);

    this.contextValue = itemType;
    this.iconPath = this.getIcon();
    this.description = this.getDescription();
    this.tooltip = this.getTooltip();

    // Add click command for table items to open data viewer
    if (itemType === 'table') {
      this.command = {
        command: 'dbViewer.viewTableData',
        title: 'View Table Data',
        arguments: [this]
      };
    }
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.itemType) {
      case 'database':
        return new vscode.ThemeIcon('database');
      case 'folder':
        return new vscode.ThemeIcon('folder');
      case 'table':
        return new vscode.ThemeIcon('table');
      case 'column':
        const column = this.data as IColumn;
        if (column?.primaryKey) {
          return new vscode.ThemeIcon('key');
        }
        return new vscode.ThemeIcon('symbol-field');
      case 'index':
        return new vscode.ThemeIcon('list-tree');
      case 'view':
        return new vscode.ThemeIcon('eye');
      case 'procedure':
        return new vscode.ThemeIcon('symbol-method');
      case 'trigger':
        return new vscode.ThemeIcon('zap');
      case 'user':
        return new vscode.ThemeIcon('person');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }

  private getDescription(): string | undefined {
    switch (this.itemType) {
      case 'table':
        const table = this.data as ITable;
        return table?.rowCount !== undefined ? `${table.rowCount} rows` : undefined;
      case 'column':
        const column = this.data as IColumn;
        if (column) {
          const parts = [column.type];
          if (!column.nullable) parts.push('NOT NULL');
          if (column.primaryKey) parts.push('PK');
          return parts.join(' ');
        }
        return undefined;
      case 'index':
        const index = this.data as IIndex;
        return index?.unique ? 'UNIQUE' : undefined;
      case 'view':
        return 'view';
      case 'procedure':
        const proc = this.data as IStoredProcedure;
        return proc?.returnType || 'procedure';
      case 'trigger':
        const trig = this.data as ITrigger;
        return trig?.event ? `${trig.timing} ${trig.event}` : 'trigger';
      case 'user':
        const user = this.data as IUser;
        return user?.canLogin ? 'can login' : 'no login';
      default:
        return undefined;
    }
  }

  private getTooltip(): string | undefined {
    switch (this.itemType) {
      case 'table':
        const table = this.data as ITable;
        if (table) {
          const lines = [`Table: ${table.name}`];
          if (table.rowCount !== undefined) {
            lines.push(`Rows: ${table.rowCount}`);
          }
          lines.push(`Columns: ${table.columns.length}`);
          lines.push(`Indexes: ${table.indexes.length}`);
          return lines.join('\n');
        }
        return undefined;
      case 'column':
        const column = this.data as IColumn;
        if (column) {
          const lines = [
            `Column: ${column.name}`,
            `Type: ${column.type}`,
            `Nullable: ${column.nullable ? 'Yes' : 'No'}`,
            `Primary Key: ${column.primaryKey ? 'Yes' : 'No'}`
          ];
          if (column.defaultValue !== undefined && column.defaultValue !== null) {
            lines.push(`Default: ${column.defaultValue}`);
          }
          return lines.join('\n');
        }
        return undefined;
      case 'index':
        const index = this.data as IIndex;
        if (index) {
          return [
            `Index: ${index.name}`,
            `Columns: ${index.columns.join(', ')}`,
            `Unique: ${index.unique ? 'Yes' : 'No'}`
          ].join('\n');
        }
        return undefined;
      case 'view':
        const view = this.data as IView;
        if (view) {
          const lines = [`View: ${view.name}`];
          if (view.schema) lines.push(`Schema: ${view.schema}`);
          return lines.join('\n');
        }
        return `View: ${this.label}`;
      case 'procedure':
        const procTip = this.data as IStoredProcedure;
        if (procTip) {
          const lines = [`Stored Procedure: ${procTip.name}`];
          if (procTip.returnType) lines.push(`Returns: ${procTip.returnType}`);
          if (procTip.language) lines.push(`Language: ${procTip.language}`);
          if (procTip.parameters && procTip.parameters.length > 0) {
            lines.push(`Parameters: ${procTip.parameters.map(p => `${p.name} ${p.type}`).join(', ')}`);
          }
          return lines.join('\n');
        }
        return `Stored Procedure: ${this.label}`;
      case 'trigger':
        const trigTip = this.data as ITrigger;
        if (trigTip) {
          const lines = [`Trigger: ${trigTip.name}`];
          lines.push(`Table: ${trigTip.table}`);
          lines.push(`Event: ${trigTip.timing} ${trigTip.event}`);
          if (trigTip.enabled !== undefined) {
            lines.push(`Enabled: ${trigTip.enabled ? 'Yes' : 'No'}`);
          }
          return lines.join('\n');
        }
        return `Trigger: ${this.label}`;
      case 'user':
        const userTip = this.data as IUser;
        if (userTip) {
          const lines = [`User: ${userTip.name}`];
          if (userTip.host) lines.push(`Host: ${userTip.host}`);
          if (userTip.roles && userTip.roles.length > 0) {
            lines.push(`Roles: ${userTip.roles.join(', ')}`);
          }
          if (userTip.superuser) lines.push('Superuser: Yes');
          if (userTip.canLogin !== undefined) {
            lines.push(`Can Login: ${userTip.canLogin ? 'Yes' : 'No'}`);
          }
          return lines.join('\n');
        }
        return `User: ${this.label}`;
      default:
        return undefined;
    }
  }
}

export class SchemaTreeProvider implements vscode.TreeDataProvider<SchemaTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SchemaTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cachedSchema = new Map<string, { tables: ITable[]; timestamp: number }>();
  private readonly CACHE_TTL = 60000;

  constructor(private connectionService: ConnectionService) {
    connectionService.onConnectionsChanged(() => this.refresh());
  }

  refresh(): void {
    this.cachedSchema.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SchemaTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SchemaTreeItem): Promise<SchemaTreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }

    switch (element.itemType) {
      case 'database':
        return this.getDatabaseChildren(element);
      case 'folder':
        return this.getFolderChildren(element);
      case 'table':
        return this.getTableChildren(element);
      default:
        return [];
    }
  }

  private getRootItems(): SchemaTreeItem[] {
    const connections = this.connectionService.getAllConnections();
    const connectedIds = connections
      .filter(conn => this.connectionService.isConnected(conn.id))
      .map(conn => conn.id);

    return connectedIds.map(connId => {
      const config = this.connectionService.getConnection(connId)!;
      return new SchemaTreeItem(
        config.name,
        'database',
        connId,
        vscode.TreeItemCollapsibleState.Expanded,
        config
      );
    });
  }

  private async getDatabaseChildren(element: SchemaTreeItem): Promise<SchemaTreeItem[]> {
    const items: SchemaTreeItem[] = [
      new SchemaTreeItem(
        'Tables',
        'folder',
        element.connectionId,
        vscode.TreeItemCollapsibleState.Expanded
      ),
      new SchemaTreeItem(
        'Views',
        'folder',
        element.connectionId,
        vscode.TreeItemCollapsibleState.Collapsed
      ),
    ];

    // Check if adapter supports additional schema objects
    const adapter = AdapterFactory.get(element.connectionId);
    if (adapter?.isConnected()) {
      if (adapter.getStoredProcedures) {
        items.push(new SchemaTreeItem(
          'Stored Procedures',
          'folder',
          element.connectionId,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }
      if (adapter.getTriggers) {
        items.push(new SchemaTreeItem(
          'Triggers',
          'folder',
          element.connectionId,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }
      if (adapter.getUsers) {
        items.push(new SchemaTreeItem(
          'Users',
          'folder',
          element.connectionId,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }
    }

    return items;
  }

  private async getFolderChildren(element: SchemaTreeItem): Promise<SchemaTreeItem[]> {
    if (element.label === 'Tables') {
      return this.getTablesForConnection(element.connectionId);
    }
    if (element.label === 'Views') {
      return this.getViewsForConnection(element.connectionId);
    }
    if (element.label === 'Stored Procedures') {
      return this.getStoredProceduresForConnection(element.connectionId);
    }
    if (element.label === 'Triggers') {
      return this.getTriggersForConnection(element.connectionId);
    }
    if (element.label === 'Users') {
      return this.getUsersForConnection(element.connectionId);
    }
    // Handle Columns and Indexes subfolders for tables
    if (element.parentTable) {
      return this.getTableSubfolderChildren(element);
    }
    return [];
  }

  private async getTablesForConnection(connectionId: string): Promise<SchemaTreeItem[]> {
    try {
      const tables = await this.fetchTables(connectionId);

      return tables.map(
        table =>
          new SchemaTreeItem(
            table.name,
            'table',
            connectionId,
            vscode.TreeItemCollapsibleState.Collapsed,
            table
          )
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to load tables: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private async getViewsForConnection(connectionId: string): Promise<SchemaTreeItem[]> {
    try {
      const adapter = AdapterFactory.get(connectionId);
      if (!adapter?.isConnected()) {
        return [];
      }

      // Prefer adapter.getViews() if available
      if (adapter.getViews) {
        const views = await adapter.getViews();
        return views.map(
          view =>
            new SchemaTreeItem(
              view.name,
              'view',
              connectionId,
              vscode.TreeItemCollapsibleState.None,
              view
            )
        );
      }

      // Fallback to getSchema()
      const schema = await adapter.getSchema();
      const views = schema.databases[0]?.views || [];

      return views.map(
        view =>
          new SchemaTreeItem(
            view.name,
            'view',
            connectionId,
            vscode.TreeItemCollapsibleState.None,
            view
          )
      );
    } catch {
      return [];
    }
  }

  private async fetchTables(connectionId: string): Promise<ITable[]> {
    const cached = this.cachedSchema.get(connectionId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.tables;
    }

    const adapter = AdapterFactory.get(connectionId);
    if (!adapter?.isConnected()) {
      throw new Error('Not connected to database');
    }

    const tables = await adapter.getTables();
    this.cachedSchema.set(connectionId, { tables, timestamp: Date.now() });

    return tables;
  }

  private async getTableChildren(element: SchemaTreeItem): Promise<SchemaTreeItem[]> {
    const table = element.data as ITable;
    if (!table) {
      return [];
    }

    const items: SchemaTreeItem[] = [];

    items.push(
      new SchemaTreeItem(
        'Columns',
        'folder',
        element.connectionId,
        vscode.TreeItemCollapsibleState.Expanded,
        undefined,
        table.name
      )
    );

    if (table.indexes.length > 0) {
      items.push(
        new SchemaTreeItem(
          'Indexes',
          'folder',
          element.connectionId,
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          table.name
        )
      );
    }

    return items;
  }

  private async getStoredProceduresForConnection(connectionId: string): Promise<SchemaTreeItem[]> {
    try {
      const adapter = AdapterFactory.get(connectionId);
      if (!adapter?.isConnected() || !adapter.getStoredProcedures) return [];
      const procs = await adapter.getStoredProcedures();
      return procs.map(proc =>
        new SchemaTreeItem(
          proc.name,
          'procedure',
          connectionId,
          vscode.TreeItemCollapsibleState.None,
          proc
        )
      );
    } catch { return []; }
  }

  private async getTriggersForConnection(connectionId: string): Promise<SchemaTreeItem[]> {
    try {
      const adapter = AdapterFactory.get(connectionId);
      if (!adapter?.isConnected() || !adapter.getTriggers) return [];
      const triggers = await adapter.getTriggers();
      return triggers.map(trigger =>
        new SchemaTreeItem(
          trigger.name,
          'trigger',
          connectionId,
          vscode.TreeItemCollapsibleState.None,
          trigger
        )
      );
    } catch { return []; }
  }

  private async getUsersForConnection(connectionId: string): Promise<SchemaTreeItem[]> {
    try {
      const adapter = AdapterFactory.get(connectionId);
      if (!adapter?.isConnected() || !adapter.getUsers) return [];
      const users = await adapter.getUsers();
      return users.map(user =>
        new SchemaTreeItem(
          user.name,
          'user',
          connectionId,
          vscode.TreeItemCollapsibleState.None,
          user
        )
      );
    } catch { return []; }
  }

  private async getTableSubfolderChildren(element: SchemaTreeItem): Promise<SchemaTreeItem[]> {
    if (element.label === 'Columns' && element.parentTable) {
      try {
        const adapter = AdapterFactory.get(element.connectionId);
        if (!adapter?.isConnected()) return [];
        const columns = await adapter.getColumns(element.parentTable);
        return columns.map(column =>
          new SchemaTreeItem(
            column.name,
            'column',
            element.connectionId,
            vscode.TreeItemCollapsibleState.None,
            column,
            element.parentTable
          )
        );
      } catch { return []; }
    }
    if (element.label === 'Indexes' && element.parentTable) {
      try {
        const adapter = AdapterFactory.get(element.connectionId);
        if (!adapter?.isConnected()) return [];
        const indexes = await adapter.getIndexes(element.parentTable);
        return indexes.map(index =>
          new SchemaTreeItem(
            index.name,
            'index',
            element.connectionId,
            vscode.TreeItemCollapsibleState.None,
            index,
            element.parentTable
          )
        );
      } catch { return []; }
    }
    return [];
  }

  getParent(): vscode.ProviderResult<SchemaTreeItem> {
    return null;
  }
}

export class TableColumnsProvider implements vscode.TreeDataProvider<SchemaTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SchemaTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private schemaProvider: SchemaTreeProvider;

  constructor(schemaProvider: SchemaTreeProvider) {
    this.schemaProvider = schemaProvider;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SchemaTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SchemaTreeItem): Promise<SchemaTreeItem[]> {
    if (!element) {
      return [];
    }

    if (element.itemType === 'folder' && element.label === 'Columns' && element.parentTable) {
      return this.getColumnItems(element);
    }

    if (element.itemType === 'folder' && element.label === 'Indexes' && element.parentTable) {
      return this.getIndexItems(element);
    }

    return [];
  }

  private async getColumnItems(element: SchemaTreeItem): Promise<SchemaTreeItem[]> {
    try {
      const adapter = AdapterFactory.get(element.connectionId);
      if (!adapter?.isConnected()) {
        return [];
      }

      const columns = await adapter.getColumns(element.parentTable!);

      return columns.map(
        column =>
          new SchemaTreeItem(
            column.name,
            'column',
            element.connectionId,
            vscode.TreeItemCollapsibleState.None,
            column,
            element.parentTable
          )
      );
    } catch {
      return [];
    }
  }

  private async getIndexItems(element: SchemaTreeItem): Promise<SchemaTreeItem[]> {
    try {
      const adapter = AdapterFactory.get(element.connectionId);
      if (!adapter?.isConnected()) {
        return [];
      }

      const indexes = await adapter.getIndexes(element.parentTable!);

      return indexes.map(
        index =>
          new SchemaTreeItem(
            index.name,
            'index',
            element.connectionId,
            vscode.TreeItemCollapsibleState.None,
            index,
            element.parentTable
          )
      );
    } catch {
      return [];
    }
  }

  getParent(): vscode.ProviderResult<SchemaTreeItem> {
    return null;
  }
}
