import { Client, type types } from 'cassandra-driver';
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

export class CassandraAdapter extends BaseAdapter implements IDatabaseAdapter {
  private client: Client | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.client) {
      return;
    }

    const host = this._config.host || 'localhost';
    const port = this._config.port || 9042;

    try {
      const clientOptions: Record<string, unknown> = {
        contactPoints: [`${host}:${port}`],
        localDataCenter: (this._config.options?.localDataCenter as string) || 'datacenter1',
        keyspace: this._config.database || undefined
      };

      if (this._config.username && this._config.password) {
        clientOptions.credentials = {
          username: this._config.username,
          password: this._config.password
        };
      }

      if (this._config.ssl) {
        clientOptions.sslOptions = typeof this._config.ssl === 'boolean'
          ? { rejectUnauthorized: false }
          : this._config.ssl;
      }

      this.client = new Client(clientOptions as ConstructorParameters<typeof Client>[0]);
      await this.client.connect();
      this._connected = true;
    } catch (error) {
      this._connected = false;
      this.client = null;
      throw new Error(`Failed to connect to Cassandra: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.shutdown();
      this.client = null;
    }
    this._connected = false;
  }

  private ensureClient(): Client {
    if (!this.client) {
      throw new Error('Not connected to database');
    }
    return this.client;
  }

  private getKeyspace(): string {
    return this._config.database || 'system';
  }

  async executeQuery(cql: string, params?: unknown[]): Promise<IQueryResult> {
    const client = this.ensureClient();
    const startTime = Date.now();

    try {
      const result = await client.execute(cql, params as types.ArrayOrObject | undefined, {
        prepare: true
      });

      const columns: IColumn[] = result.columns
        ? result.columns.map(col => ({
            name: col.name,
            type: col.type?.code !== undefined ? this.mapCassandraType(col.type.code) : 'unknown',
            nullable: true,
            primaryKey: false
          }))
        : [];

      const rows: Record<string, unknown>[] = result.rows
        ? result.rows.map(row => {
            const obj: Record<string, unknown> = {};
            if (result.columns) {
              for (const col of result.columns) {
                obj[col.name] = row[col.name];
              }
            }
            return obj;
          })
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
    const keyspace = database || this.getKeyspace();

    const result = await this.executeQuery(
      'SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?',
      [keyspace]
    );

    const tables: ITable[] = [];
    for (const row of result.rows) {
      const tableName = String(row.table_name);
      const columns = await this.getColumns(tableName);
      const indexes = await this.getIndexes(tableName);

      tables.push({
        name: tableName,
        schema: keyspace,
        columns,
        indexes,
        foreignKeys: []
      });
    }

    return tables;
  }

  async getColumns(table: string, _schema?: string): Promise<IColumn[]> {
    const keyspace = this.getKeyspace();

    const result = await this.executeQuery(
      'SELECT column_name, type, kind FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?',
      [keyspace, table]
    );

    return result.rows.map(row => ({
      name: String(row.column_name),
      type: String(row.type),
      nullable: true,
      primaryKey: row.kind === 'partition_key' || row.kind === 'clustering'
    }));
  }

  async getIndexes(table: string, _schema?: string): Promise<IIndex[]> {
    const keyspace = this.getKeyspace();

    const result = await this.executeQuery(
      'SELECT index_name, options FROM system_schema.indexes WHERE keyspace_name = ? AND table_name = ?',
      [keyspace, table]
    );

    return result.rows.map(row => {
      const options = row.options as Record<string, string> | undefined;
      const target = options?.target || '';

      return {
        name: String(row.index_name || 'unnamed'),
        columns: target ? [target] : [],
        unique: false
      };
    });
  }

  async getSchema(): Promise<ISchema> {
    const databases = await this.getDatabases();
    const schemaDBs = [];

    for (const dbName of databases) {
      const tables = await this.getTables(dbName);
      schemaDBs.push({
        name: dbName,
        tables,
        views: []
      });
    }

    return {
      databases: schemaDBs
    };
  }

  async getDatabases(): Promise<string[]> {
    const result = await this.executeQuery(
      'SELECT keyspace_name FROM system_schema.keyspaces'
    );
    return result.rows.map(row => String(row.keyspace_name));
  }

  async getPrimaryKey(table: string, _schema?: string): Promise<string[]> {
    const keyspace = this.getKeyspace();

    const result = await this.executeQuery(
      `SELECT column_name, kind FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ? AND kind IN ('partition_key', 'clustering')`,
      [keyspace, table]
    );

    return result.rows.map(row => String(row.column_name));
  }

  async getVersion(): Promise<string> {
    const result = await this.executeQuery(
      'SELECT release_version FROM system.local'
    );

    if (result.rows.length > 0) {
      return String(result.rows[0].release_version);
    }

    return 'Unknown';
  }

  async insertRow(table: string, data: Record<string, unknown>): Promise<IQueryResult> {
    const startTime = Date.now();

    try {
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = columns.map(() => '?').join(', ');

      const cql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(', ')}) VALUES (${placeholders})`;

      return await this.executeQuery(cql, values);
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
      const whereClauses: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(where)) {
        whereClauses.push(`${this.escapeIdentifier(key)} = ?`);
        values.push(value);
      }

      const cql = `DELETE FROM ${this.escapeIdentifier(table)} WHERE ${whereClauses.join(' AND ')}`;
      return await this.executeQuery(cql, values);
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
      const setClauses: string[] = [];
      const whereClauses: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(data)) {
        setClauses.push(`${this.escapeIdentifier(key)} = ?`);
        values.push(value);
      }

      for (const [key, value] of Object.entries(where)) {
        whereClauses.push(`${this.escapeIdentifier(key)} = ?`);
        values.push(value);
      }

      const cql = `UPDATE ${this.escapeIdentifier(table)} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
      return await this.executeQuery(cql, values);
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

  protected escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  protected override getTestQuery(): string {
    return 'SELECT now() FROM system.local';
  }

  protected override getPlaceholder(_index: number): string {
    return '?';
  }

  private mapCassandraType(typeCode: number): string {
    const typeMap: Record<number, string> = {
      0x0000: 'custom',
      0x0001: 'ascii',
      0x0002: 'bigint',
      0x0003: 'blob',
      0x0004: 'boolean',
      0x0005: 'counter',
      0x0006: 'decimal',
      0x0007: 'double',
      0x0008: 'float',
      0x0009: 'int',
      0x000A: 'text',
      0x000B: 'timestamp',
      0x000C: 'uuid',
      0x000D: 'varchar',
      0x000E: 'varint',
      0x000F: 'timeuuid',
      0x0010: 'inet',
      0x0011: 'date',
      0x0012: 'time',
      0x0013: 'smallint',
      0x0014: 'tinyint',
      0x0020: 'list',
      0x0021: 'map',
      0x0022: 'set',
      0x0030: 'udt',
      0x0031: 'tuple'
    };
    return typeMap[typeCode] || 'unknown';
  }
}
