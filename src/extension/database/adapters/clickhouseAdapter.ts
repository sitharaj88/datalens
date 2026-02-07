import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { BaseAdapter } from './baseAdapter';
import type { IDatabaseAdapter } from '../interfaces/IAdapter';
import type {
  DatabaseType,
  IConnectionConfig,
  ISchema,
  ITable,
  IColumn,
  IIndex,
  IQueryResult,
  IQueryOptions,
  IStoredProcedure,
  ITrigger,
  IView,
  IQueryPlan,
  IUser,
  IRole,
  ISchemaMetadata
} from '../../../shared/types/database';

export class ClickHouseAdapter extends BaseAdapter implements IDatabaseAdapter {
  private client: ClickHouseClient | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.client) {
      return;
    }

    const host = this._config.host || 'localhost';
    const port = this._config.port || 8123;
    const protocol = this._config.ssl ? 'https' : 'http';

    try {
      this.client = createClient({
        url: `${protocol}://${host}:${port}`,
        username: this._config.username || 'default',
        password: this._config.password || '',
        database: this._config.database || 'default'
      });

      // Verify connectivity with a test query
      await this.client.query({ query: 'SELECT 1', format: 'JSONEachRow' });
      this._connected = true;
    } catch (error) {
      this._connected = false;
      this.client = null;
      throw new Error(`Failed to connect to ClickHouse: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this._connected = false;
  }

  private ensureClient(): ClickHouseClient {
    if (!this.client) {
      throw new Error('Not connected to database');
    }
    return this.client;
  }

  async executeQuery(sql: string, params?: unknown[]): Promise<IQueryResult> {
    const client = this.ensureClient();
    const startTime = Date.now();

    try {
      // Substitute positional params with escaped values if provided
      let processedSql = sql;
      if (params && params.length > 0) {
        let paramIndex = 0;
        processedSql = sql.replace(/\?/g, () => {
          const value = params[paramIndex++];
          return this.escapeValue(value);
        });
      }

      const resultSet = await client.query({
        query: processedSql,
        format: 'JSONEachRow'
      });

      const rows = await resultSet.json<Record<string, unknown>[]>();

      const columns: IColumn[] = rows.length > 0
        ? Object.keys(rows[0]).map(key => ({
            name: key,
            type: this.inferClickHouseType(rows[0][key]),
            nullable: true,
            primaryKey: false
          }))
        : [];

      return {
        columns,
        rows,
        rowCount: rows.length,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getTables(database?: string): Promise<ITable[]> {
    const db = database || this._config.database || 'default';
    const result = await this.executeQuery(`SHOW TABLES FROM ${this.escapeIdentifier(db)}`);

    const tables: ITable[] = [];
    for (const row of result.rows) {
      const tableName = String(row.name || row.Name || Object.values(row)[0]);
      const columns = await this.getColumns(tableName);
      const indexes = await this.getIndexes(tableName);

      tables.push({
        name: tableName,
        schema: db,
        columns,
        indexes,
        foreignKeys: []
      });
    }

    return tables;
  }

  async getColumns(table: string, _schema?: string): Promise<IColumn[]> {
    const result = await this.executeQuery(`DESCRIBE TABLE ${this.escapeIdentifier(table)}`);

    return result.rows.map(row => ({
      name: String(row.name || ''),
      type: String(row.type || ''),
      nullable: String(row.type || '').startsWith('Nullable'),
      primaryKey: false,
      defaultValue: row.default_expression || undefined
    }));
  }

  async getIndexes(table: string, _schema?: string): Promise<IIndex[]> {
    const db = this._config.database || 'default';

    const result = await this.executeQuery(
      `SELECT name, expr, type FROM system.data_skipping_indices WHERE database = ? AND table = ?`,
      [db, table]
    );

    return result.rows.map(row => ({
      name: String(row.name || 'unnamed'),
      columns: String(row.expr || '').split(',').map(c => c.trim()),
      unique: false
    }));
  }

  async getSchema(): Promise<ISchema> {
    const databases = await this.getDatabases();
    const schemaDBs = [];

    for (const dbName of databases) {
      const tables = await this.getTables(dbName);
      const views = await this.getViews(dbName);

      schemaDBs.push({
        name: dbName,
        tables,
        views
      });
    }

    return {
      databases: schemaDBs
    };
  }

  async getDatabases(): Promise<string[]> {
    const result = await this.executeQuery('SHOW DATABASES');
    return result.rows.map(row => String(row.name || row.Name || Object.values(row)[0]));
  }

  async getPrimaryKey(table: string, _schema?: string): Promise<string[]> {
    const db = this._config.database || 'default';

    const result = await this.executeQuery(
      `SELECT name FROM system.columns WHERE database = ? AND table = ? AND is_in_primary_key = 1`,
      [db, table]
    );

    return result.rows.map(row => String(row.name));
  }

  async getVersion(): Promise<string> {
    const result = await this.executeQuery('SELECT version() AS version');
    if (result.rows.length > 0) {
      return String(result.rows[0].version);
    }
    return 'Unknown';
  }

  async getViews(database?: string): Promise<IView[]> {
    const db = database || this._config.database || 'default';

    const result = await this.executeQuery(
      `SELECT name, engine FROM system.tables WHERE database = ? AND (engine = 'View' OR engine = 'MaterializedView')`,
      [db]
    );

    return result.rows.map(row => ({
      name: String(row.name),
      schema: db,
      definition: undefined
    }));
  }

  async insertRow(table: string, data: Record<string, unknown>): Promise<IQueryResult> {
    const startTime = Date.now();

    try {
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map(v => this.escapeValue(v)).join(', ');

      const sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(', ')}) VALUES (${placeholders})`;

      return await this.executeQuery(sql);
    } catch (error) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async deleteRow(table: string, where: Record<string, unknown>): Promise<IQueryResult> {
    const startTime = Date.now();

    try {
      const whereClauses = Object.entries(where)
        .map(([key, value]) => `${this.escapeIdentifier(key)} = ${this.escapeValue(value)}`)
        .join(' AND ');

      const sql = `ALTER TABLE ${this.escapeIdentifier(table)} DELETE WHERE ${whereClauses}`;
      return await this.executeQuery(sql);
    } catch (error) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async updateRow(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<IQueryResult> {
    const startTime = Date.now();

    try {
      const setClauses = Object.entries(data)
        .map(([key, value]) => `${this.escapeIdentifier(key)} = ${this.escapeValue(value)}`)
        .join(', ');

      const whereClauses = Object.entries(where)
        .map(([key, value]) => `${this.escapeIdentifier(key)} = ${this.escapeValue(value)}`)
        .join(' AND ');

      const sql = `ALTER TABLE ${this.escapeIdentifier(table)} UPDATE ${setClauses} WHERE ${whereClauses}`;
      return await this.executeQuery(sql);
    } catch (error) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async explainQuery(sql: string): Promise<IQueryPlan> {
    const result = await this.executeQuery(`EXPLAIN plan = 1 ${sql}`);
    return {
      plan: result.rows,
      textRepresentation: result.rows.map(r => Object.values(r).join(' ')).join('\n')
    };
  }

  protected escapeIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  protected override getTestQuery(): string {
    return 'SELECT 1';
  }

  protected override getPlaceholder(index: number): string {
    return '?';
  }

  private inferClickHouseType(value: unknown): string {
    if (value === null || value === undefined) {
      return 'Nullable(String)';
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'Int64' : 'Float64';
    }
    if (typeof value === 'boolean') {
      return 'UInt8';
    }
    if (typeof value === 'string') {
      return 'String';
    }
    if (Array.isArray(value)) {
      return 'Array(String)';
    }
    return 'String';
  }
}
