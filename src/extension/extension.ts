import * as vscode from 'vscode';
import { ConnectionService } from './services/connectionService';
import { ConnectionTreeProvider, ConnectionTreeItem } from './providers/connectionTreeProvider';
import { SchemaTreeProvider, SchemaTreeItem } from './providers/schemaTreeProvider';
import { QueryPanelManager } from './providers/webviewProvider';
import { ConnectionStringParser } from './services/connectionStringParser';
import { SSHTunnelService } from './services/sshTunnelService';
import { ConnectionGroupService } from './services/connectionGroupService';
import { AIService } from './services/aiService';
import { QueryBookmarkService } from './services/queryBookmarkService';
import { QueryLibraryTreeProvider } from './providers/queryLibraryTreeProvider';
import { GlobalSearchService } from './services/globalSearchService';
import { DatabaseType } from '../shared/types/database';
import { DEFAULT_PORT } from '../shared/constants';
import type { IConnectionConfig } from '../shared/types/database';

let connectionService: ConnectionService;
let queryPanelManager: QueryPanelManager;
let sshTunnelService: SSHTunnelService;
let connectionGroupService: ConnectionGroupService;
let aiService: AIService;
let bookmarkService: QueryBookmarkService;
let globalSearchService: GlobalSearchService;

export function activate(context: vscode.ExtensionContext): void {
  console.log('Database Viewer extension is now active');

  connectionService = new ConnectionService(context);
  sshTunnelService = new SSHTunnelService();
  connectionGroupService = new ConnectionGroupService(context);
  aiService = new AIService();
  bookmarkService = new QueryBookmarkService(context);
  globalSearchService = new GlobalSearchService(connectionService);

  const connectionTreeProvider = new ConnectionTreeProvider(connectionService);
  const schemaTreeProvider = new SchemaTreeProvider(connectionService);
  const queryLibraryTreeProvider = new QueryLibraryTreeProvider(bookmarkService);
  queryPanelManager = new QueryPanelManager(context.extensionUri, connectionService);

  // Wire services into the message router used by webview panels
  queryPanelManager.setAIService(aiService);
  queryPanelManager.setBookmarkService(bookmarkService);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('dbViewer.connections', connectionTreeProvider),
    vscode.window.registerTreeDataProvider('dbViewer.schemaExplorer', schemaTreeProvider),
    vscode.window.registerTreeDataProvider('dbViewer.queryLibrary', queryLibraryTreeProvider)
  );

  // Refresh AI service when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('dbViewer.ai')) {
        aiService.refreshProvider();
      }
    })
  );

  // Core connection commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dbViewer.addConnection', () => addConnection()),
    vscode.commands.registerCommand('dbViewer.addConnectionFromURI', () => addConnectionFromURI()),
    vscode.commands.registerCommand('dbViewer.removeConnection', (item: ConnectionTreeItem) =>
      removeConnection(item)
    ),
    vscode.commands.registerCommand('dbViewer.connect', (item: ConnectionTreeItem) =>
      connect(item, schemaTreeProvider)
    ),
    vscode.commands.registerCommand('dbViewer.disconnect', (item: ConnectionTreeItem) =>
      disconnect(item, schemaTreeProvider)
    ),
    vscode.commands.registerCommand('dbViewer.refresh', () => {
      connectionTreeProvider.refresh();
      schemaTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('dbViewer.newQuery', (item?: SchemaTreeItem) =>
      newQuery(item)
    ),
    vscode.commands.registerCommand('dbViewer.viewTableData', (item: SchemaTreeItem) =>
      viewTableData(item)
    ),
    vscode.commands.registerCommand('dbViewer.discoverConnections', () => discoverConnections())
  );

  // Connection group commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dbViewer.createGroup', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Enter group name' });
      if (name) {
        connectionGroupService.createGroup(name);
        connectionTreeProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('dbViewer.renameGroup', async (item: { groupId: string }) => {
      const name = await vscode.window.showInputBox({ prompt: 'Enter new group name' });
      if (name && item.groupId) {
        const group = connectionGroupService.getGroups().find(g => g.id === item.groupId);
        if (group) {
          connectionGroupService.updateGroup({ ...group, name });
          connectionTreeProvider.refresh();
        }
      }
    }),
    vscode.commands.registerCommand('dbViewer.deleteGroup', (item: { groupId: string }) => {
      if (item.groupId) {
        connectionGroupService.deleteGroup(item.groupId);
        connectionTreeProvider.refresh();
      }
    })
  );

  // Context menu commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dbViewer.copyTableName', (item: SchemaTreeItem) => {
      if (item.label) {
        vscode.env.clipboard.writeText(String(item.label));
        vscode.window.showInformationMessage(`Copied "${item.label}" to clipboard`);
      }
    }),
    vscode.commands.registerCommand('dbViewer.generateSelect', (item: SchemaTreeItem) => {
      if (item.label && item.itemType === 'table') {
        const sql = `SELECT * FROM ${item.label} LIMIT 100;`;
        vscode.env.clipboard.writeText(sql);
        vscode.window.showInformationMessage('SELECT query copied to clipboard');
      }
    }),
    vscode.commands.registerCommand('dbViewer.generateInsert', (item: SchemaTreeItem) => {
      if (item.label && item.itemType === 'table') {
        const sql = `INSERT INTO ${item.label} () VALUES ();`;
        vscode.env.clipboard.writeText(sql);
        vscode.window.showInformationMessage('INSERT template copied to clipboard');
      }
    })
  );

  // Global search command
  context.subscriptions.push(
    vscode.commands.registerCommand('dbViewer.globalSearch', async () => {
      const term = await vscode.window.showInputBox({
        prompt: 'Search across all connected databases',
        placeHolder: 'Enter table, column, or view name...'
      });

      if (!term) return;

      try {
        const results = await globalSearchService.search(term);
        if (results.length === 0) {
          vscode.window.showInformationMessage(`No results found for "${term}"`);
          return;
        }

        const items = results.map(r => ({
          label: r.name,
          description: r.parent ? `${r.parent} (${r.type})` : r.type,
          detail: `${r.connectionName}${r.detail ? ` - ${r.detail}` : ''}`,
          result: r
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `${results.length} result(s) found`,
          matchOnDescription: true,
          matchOnDetail: true
        });

        if (selected && selected.result.type === 'table') {
          queryPanelManager.createOrShowPanel(selected.result.connectionId, selected.result.name);
        } else if (selected && selected.result.type === 'column' && selected.result.parent) {
          queryPanelManager.createOrShowPanel(selected.result.connectionId, selected.result.parent);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  // Saved query commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dbViewer.openSavedQuery', (query: { query: string; connectionId?: string }) => {
      if (query.connectionId) {
        const panel = queryPanelManager.createOrShowPanel(query.connectionId);
        panel.webview.postMessage({ type: 'SET_QUERY', query: query.query });
      }
    }),
    vscode.commands.registerCommand('dbViewer.saveQuery', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Enter a name for this saved query' });
      if (!name) return;

      const query = await vscode.window.showInputBox({ prompt: 'Enter the SQL query' });
      if (!query) return;

      const tagsInput = await vscode.window.showInputBox({ prompt: 'Enter tags (comma-separated, optional)' });
      const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

      await bookmarkService.save({ name, query, tags });
      vscode.window.showInformationMessage(`Query "${name}" saved`);
    }),
    vscode.commands.registerCommand('dbViewer.exportData', async (item: SchemaTreeItem) => {
      if (item.itemType !== 'table') return;
      const panel = queryPanelManager.createOrShowPanel(item.connectionId, item.label as string);
      panel.webview.postMessage({ type: 'TRIGGER_EXPORT' });
    })
  );
}

export function deactivate(): void {
  queryPanelManager?.disposeAll();
  connectionService?.dispose();
  sshTunnelService?.closeAll();
}

async function addConnection(): Promise<void> {
  const dbTypes: vscode.QuickPickItem[] = [
    { label: 'SQLite', description: 'Local file-based database' },
    { label: 'PostgreSQL', description: 'Advanced open-source database' },
    { label: 'MySQL', description: 'Popular open-source database' },
    { label: 'MariaDB', description: 'MySQL-compatible fork' },
    { label: 'SQL Server', description: 'Microsoft SQL Server' },
    { label: 'MongoDB', description: 'NoSQL document database' },
    { label: 'Redis', description: 'In-memory key-value store' },
    { label: 'CockroachDB', description: 'Distributed SQL database' },
    { label: 'Neo4j', description: 'Graph database' },
    { label: 'ClickHouse', description: 'OLAP analytics database' },
    { label: 'Cassandra', description: 'Wide-column NoSQL store' },
    { label: 'DynamoDB', description: 'AWS NoSQL database' },
    { label: 'Elasticsearch', description: 'Search & analytics engine' },
    { label: 'Firestore', description: 'Google Cloud NoSQL' },
    { label: 'Oracle', description: 'Oracle Database' }
  ];

  const selectedType = await vscode.window.showQuickPick(dbTypes, {
    placeHolder: 'Select database type'
  });

  if (!selectedType) return;

  let config: Omit<IConnectionConfig, 'id'> | undefined;

  switch (selectedType.label) {
    case 'SQLite':
      config = await getSQLiteConfig();
      break;
    case 'PostgreSQL':
      config = await getServerConfig(DatabaseType.PostgreSQL, DEFAULT_PORT.postgresql);
      break;
    case 'MySQL':
      config = await getServerConfig(DatabaseType.MySQL, DEFAULT_PORT.mysql);
      break;
    case 'MariaDB':
      config = await getServerConfig(DatabaseType.MariaDB, DEFAULT_PORT.mariadb);
      break;
    case 'SQL Server':
      config = await getServerConfig(DatabaseType.MSSQL, DEFAULT_PORT.mssql);
      break;
    case 'MongoDB':
      config = await getServerConfig(DatabaseType.MongoDB, DEFAULT_PORT.mongodb);
      break;
    case 'Redis':
      config = await getServerConfig(DatabaseType.Redis, DEFAULT_PORT.redis);
      break;
    case 'CockroachDB':
      config = await getServerConfig(DatabaseType.CockroachDB, DEFAULT_PORT.cockroachdb);
      break;
    case 'Neo4j':
      config = await getServerConfig(DatabaseType.Neo4j, DEFAULT_PORT.neo4j);
      break;
    case 'ClickHouse':
      config = await getServerConfig(DatabaseType.ClickHouse, DEFAULT_PORT.clickhouse);
      break;
    case 'Cassandra':
      config = await getServerConfig(DatabaseType.Cassandra, DEFAULT_PORT.cassandra);
      break;
    case 'DynamoDB':
      config = await getDynamoDBConfig();
      break;
    case 'Elasticsearch':
      config = await getServerConfig(DatabaseType.Elasticsearch, DEFAULT_PORT.elasticsearch);
      break;
    case 'Firestore':
      config = await getFirestoreConfig();
      break;
    case 'Oracle':
      config = await getServerConfig(DatabaseType.OracleDB, DEFAULT_PORT.oracle);
      break;
  }

  if (!config) return;

  // Ask for SSH tunnel
  const useSSH = await vscode.window.showQuickPick(
    [{ label: 'No', description: 'Direct connection' }, { label: 'Yes', description: 'Connect through SSH tunnel' }],
    { placeHolder: 'Use SSH tunnel?' }
  );

  if (useSSH?.label === 'Yes') {
    const sshConfig = await getSSHConfig();
    if (sshConfig) {
      config = { ...config, ...sshConfig };
    }
  }

  try {
    await connectionService.addConnection(config);
    vscode.window.showInformationMessage(`Connection "${config.name}" added successfully`);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to add connection: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function addConnectionFromURI(): Promise<void> {
  const uri = await vscode.window.showInputBox({
    prompt: 'Enter connection URI (e.g., postgresql://user:pass@host:5432/dbname)',
    placeHolder: 'protocol://user:password@host:port/database',
    validateInput: value => {
      if (!value?.trim()) return 'URI is required';
      if (!value.includes('://')) return 'Invalid URI format';
      return null;
    }
  });

  if (!uri) return;

  const parsed = ConnectionStringParser.parse(uri);
  if (!parsed || !parsed.type) {
    vscode.window.showErrorMessage('Could not parse connection URI. Unsupported protocol.');
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for this connection',
    value: parsed.database || 'Connection',
    validateInput: value => (value?.trim() ? null : 'Name is required')
  });

  if (!name) return;

  try {
    await connectionService.addConnection({
      name,
      type: parsed.type,
      host: parsed.host,
      port: parsed.port,
      database: parsed.database || '',
      username: parsed.username,
      password: parsed.password,
      ssl: parsed.ssl,
      connectionString: uri
    });
    vscode.window.showInformationMessage(`Connection "${name}" added successfully`);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to add connection: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function getSSHConfig(): Promise<Partial<IConnectionConfig> | undefined> {
  const sshHost = await vscode.window.showInputBox({
    prompt: 'SSH Host',
    validateInput: v => (v?.trim() ? null : 'SSH host is required')
  });
  if (!sshHost) return undefined;

  const sshPortStr = await vscode.window.showInputBox({
    prompt: 'SSH Port',
    value: '22'
  });

  const sshUsername = await vscode.window.showInputBox({
    prompt: 'SSH Username',
    validateInput: v => (v?.trim() ? null : 'Username is required')
  });
  if (!sshUsername) return undefined;

  const authMethod = await vscode.window.showQuickPick(
    [{ label: 'Password' }, { label: 'Private Key' }],
    { placeHolder: 'SSH Authentication Method' }
  );

  let sshPassword: string | undefined;
  let sshPrivateKey: string | undefined;

  if (authMethod?.label === 'Password') {
    sshPassword = await vscode.window.showInputBox({ prompt: 'SSH Password', password: true });
  } else if (authMethod?.label === 'Private Key') {
    const keyUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      title: 'Select SSH Private Key'
    });
    if (keyUri && keyUri.length > 0) {
      sshPrivateKey = keyUri[0].fsPath;
    }
  }

  return {
    sshEnabled: true,
    sshHost,
    sshPort: sshPortStr ? parseInt(sshPortStr, 10) : 22,
    sshUsername,
    sshPassword,
    sshPrivateKey
  };
}

async function getDynamoDBConfig(): Promise<Omit<IConnectionConfig, 'id'> | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for this connection',
    validateInput: value => (value?.trim() ? null : 'Name is required')
  });
  if (!name) return undefined;

  const region = await vscode.window.showInputBox({
    prompt: 'AWS Region',
    value: 'us-east-1'
  });

  const accessKey = await vscode.window.showInputBox({
    prompt: 'AWS Access Key ID (leave blank for default credentials)'
  });

  const secretKey = await vscode.window.showInputBox({
    prompt: 'AWS Secret Access Key',
    password: true
  });

  const endpoint = await vscode.window.showInputBox({
    prompt: 'Custom endpoint (leave blank for AWS, e.g., http://localhost:8000 for local)'
  });

  return {
    name,
    type: DatabaseType.DynamoDB,
    database: region || 'us-east-1',
    awsRegion: region || 'us-east-1',
    awsAccessKeyId: accessKey || undefined,
    awsSecretAccessKey: secretKey || undefined,
    host: endpoint ? new URL(endpoint).hostname : undefined,
    port: endpoint ? parseInt(new URL(endpoint).port) || 8000 : undefined
  };
}

async function getFirestoreConfig(): Promise<Omit<IConnectionConfig, 'id'> | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for this connection',
    validateInput: value => (value?.trim() ? null : 'Name is required')
  });
  if (!name) return undefined;

  const projectId = await vscode.window.showInputBox({
    prompt: 'Google Cloud Project ID',
    validateInput: value => (value?.trim() ? null : 'Project ID is required')
  });
  if (!projectId) return undefined;

  const keyFile = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    title: 'Select Service Account Key JSON (optional)',
    filters: { 'JSON': ['json'] }
  });

  return {
    name,
    type: DatabaseType.Firestore,
    database: projectId,
    projectId,
    serviceAccountKey: keyFile && keyFile.length > 0 ? keyFile[0].fsPath : undefined
  };
}

async function getSQLiteConfig(): Promise<Omit<IConnectionConfig, 'id'> | undefined> {
  const fileUri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'SQLite Database': ['db', 'sqlite', 'sqlite3', 'db3']
    },
    title: 'Select SQLite Database File'
  });

  if (!fileUri || fileUri.length === 0) return undefined;

  const filePath = fileUri[0].fsPath;
  const fileName = filePath.split(/[\\/]/).pop() || 'database';

  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for this connection',
    value: fileName.replace(/\.(db|sqlite|sqlite3|db3)$/, ''),
    validateInput: value => (value?.trim() ? null : 'Name is required')
  });

  if (!name) return undefined;

  return {
    name,
    type: DatabaseType.SQLite,
    database: filePath,
    filename: filePath
  };
}

async function getServerConfig(
  type: DatabaseType,
  defaultPort: number
): Promise<Omit<IConnectionConfig, 'id'> | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for this connection',
    validateInput: value => (value?.trim() ? null : 'Name is required')
  });

  if (!name) return undefined;

  const host = await vscode.window.showInputBox({
    prompt: 'Enter host',
    value: 'localhost',
    validateInput: value => (value?.trim() ? null : 'Host is required')
  });

  if (!host) return undefined;

  const portStr = await vscode.window.showInputBox({
    prompt: 'Enter port',
    value: String(defaultPort),
    validateInput: value => {
      const num = parseInt(value, 10);
      return !isNaN(num) && num > 0 && num < 65536 ? null : 'Invalid port number';
    }
  });

  if (!portStr) return undefined;

  const database = await vscode.window.showInputBox({
    prompt: 'Enter database name',
    validateInput: value => (value?.trim() ? null : 'Database name is required')
  });

  if (!database) return undefined;

  const username = await vscode.window.showInputBox({
    prompt: 'Enter username (optional)'
  });

  const password = await vscode.window.showInputBox({
    prompt: 'Enter password (optional)',
    password: true
  });

  return {
    name,
    type,
    host,
    port: parseInt(portStr, 10),
    database,
    username: username || undefined,
    password: password || undefined
  };
}

async function removeConnection(item: ConnectionTreeItem): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to remove connection "${item.connection.name}"?`,
    { modal: true },
    'Remove'
  );

  if (confirm !== 'Remove') return;

  try {
    await connectionService.removeConnection(item.connection.id);
    vscode.window.showInformationMessage(`Connection "${item.connection.name}" removed`);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to remove connection: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function connect(
  item: ConnectionTreeItem,
  schemaTreeProvider: SchemaTreeProvider
): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Connecting to ${item.connection.name}...`,
        cancellable: false
      },
      async () => {
        const config = item.connection;

        // Create SSH tunnel if enabled
        if (config.sshEnabled && config.sshHost) {
          try {
            const localPort = await sshTunnelService.createTunnel(config);
            // Update the connection to use the tunnel's local port
            await connectionService.updateConnection({
              ...config,
              options: { ...config.options, originalHost: config.host, originalPort: config.port },
              host: '127.0.0.1',
              port: localPort
            });
          } catch (error) {
            throw new Error(`SSH tunnel failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        await connectionService.connect(item.connection.id);
      }
    );

    schemaTreeProvider.refresh();
    vscode.window.showInformationMessage(`Connected to ${item.connection.name}`);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to connect: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function disconnect(
  item: ConnectionTreeItem,
  schemaTreeProvider: SchemaTreeProvider
): Promise<void> {
  try {
    await connectionService.disconnect(item.connection.id);

    // Close SSH tunnel if active
    if (item.connection.sshEnabled) {
      await sshTunnelService.closeTunnel(item.connection.id);
    }

    schemaTreeProvider.refresh();
    vscode.window.showInformationMessage(`Disconnected from ${item.connection.name}`);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function newQuery(item?: SchemaTreeItem): void {
  if (item) {
    queryPanelManager.createOrShowPanel(item.connectionId);
  } else {
    const connections = connectionService.getAllConnections()
      .filter(conn => connectionService.isConnected(conn.id));

    if (connections.length === 0) {
      vscode.window.showWarningMessage('No active database connections. Please connect first.');
      return;
    }

    if (connections.length === 1) {
      queryPanelManager.createOrShowPanel(connections[0].id);
      return;
    }

    vscode.window
      .showQuickPick(
        connections.map(c => ({ label: c.name, connectionId: c.id })),
        { placeHolder: 'Select a connection for the query' }
      )
      .then(selected => {
        if (selected) {
          queryPanelManager.createOrShowPanel(selected.connectionId);
        }
      });
  }
}

function viewTableData(item: SchemaTreeItem): void {
  if (item.itemType !== 'table') return;
  queryPanelManager.createOrShowPanel(item.connectionId, item.label as string);
}

async function discoverConnections(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('No workspace folder open');
    return;
  }

  try {
    const envFiles = await vscode.workspace.findFiles('**/.env*', '**/node_modules/**', 10);

    if (envFiles.length === 0) {
      vscode.window.showInformationMessage('No .env files found in workspace');
      return;
    }

    let discovered = 0;

    for (const envFile of envFiles) {
      const document = await vscode.workspace.openTextDocument(envFile);
      const content = document.getText();
      const config = parseEnvForDatabase(content, envFile.fsPath);

      if (config) {
        await connectionService.addConnection(config);
        discovered++;
      }
    }

    if (discovered > 0) {
      vscode.window.showInformationMessage(`Discovered ${discovered} database connection(s) from .env files`);
    } else {
      vscode.window.showInformationMessage('No database configurations found in .env files');
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to discover connections: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseEnvForDatabase(content: string, filePath: string): Omit<IConnectionConfig, 'id'> | null {
  const lines = content.split('\n');
  const env: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)$/);
    if (match) {
      env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }

  if (env.DATABASE_URL || env.DB_URL) {
    const url = env.DATABASE_URL || env.DB_URL;
    const parsed = ConnectionStringParser.parse(url);
    if (parsed && parsed.type) {
      return {
        name: `${parsed.database || 'database'} (from ${filePath.split('/').pop()})`,
        type: parsed.type,
        host: parsed.host,
        port: parsed.port,
        database: parsed.database || '',
        username: parsed.username,
        password: parsed.password,
        connectionString: url
      };
    }
  }

  if (env.REDIS_URL || env.REDIS_URI) {
    const url = env.REDIS_URL || env.REDIS_URI;
    const parsed = ConnectionStringParser.parse(url);
    if (parsed && parsed.type) {
      return {
        name: `Redis (from ${filePath.split('/').pop()})`,
        type: parsed.type,
        host: parsed.host,
        port: parsed.port,
        database: parsed.database || '0',
        username: parsed.username,
        password: parsed.password
      };
    }
  }

  if (env.DB_HOST || env.DATABASE_HOST) {
    const host = env.DB_HOST || env.DATABASE_HOST;
    const port = parseInt(env.DB_PORT || env.DATABASE_PORT || '5432', 10);
    const database = env.DB_DATABASE || env.DB_NAME || env.DATABASE_NAME || '';
    const username = env.DB_USERNAME || env.DB_USER || env.DATABASE_USER || '';
    const password = env.DB_PASSWORD || env.DATABASE_PASSWORD || '';

    const typeStr = (env.DB_CONNECTION || env.DB_DRIVER || '').toLowerCase();
    let type: DatabaseType = DatabaseType.PostgreSQL;

    if (typeStr.includes('mysql')) {
      type = DatabaseType.MySQL;
    } else if (typeStr.includes('mariadb')) {
      type = DatabaseType.MariaDB;
    } else if (typeStr.includes('mssql') || typeStr.includes('sqlserver')) {
      type = DatabaseType.MSSQL;
    } else if (typeStr.includes('mongo')) {
      type = DatabaseType.MongoDB;
    } else if (typeStr.includes('sqlite')) {
      type = DatabaseType.SQLite;
    } else if (typeStr.includes('redis')) {
      type = DatabaseType.Redis;
    } else if (typeStr.includes('cockroach')) {
      type = DatabaseType.CockroachDB;
    } else if (typeStr.includes('clickhouse')) {
      type = DatabaseType.ClickHouse;
    } else if (typeStr.includes('cassandra')) {
      type = DatabaseType.Cassandra;
    } else if (typeStr.includes('oracle')) {
      type = DatabaseType.OracleDB;
    }

    if (database) {
      return {
        name: `${database} (from ${filePath.split('/').pop()})`,
        type,
        host,
        port,
        database,
        username,
        password
      };
    }
  }

  return null;
}
