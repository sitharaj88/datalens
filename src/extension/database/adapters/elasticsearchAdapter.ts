import { Client } from '@elastic/elasticsearch';
import { BaseAdapter } from './baseAdapter';
import type {
  ISchema,
  ITable,
  IColumn,
  IIndex,
  IQueryResult,
  IConnectionConfig
} from '../interfaces/IAdapter';
import type {
  IView,
  ISchemaMetadata
} from '../../../shared/types/database';
import { DatabaseType } from '../../../shared/types/database';

export class ElasticsearchAdapter extends BaseAdapter {
  private client: Client | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.client) {
      return;
    }

    try {
      const protocol = this._config.ssl ? 'https' : 'http';
      const host = this._config.host || 'localhost';
      const port = this._config.port || 9200;
      const node = `${protocol}://${host}:${port}`;

      const clientOptions: Record<string, unknown> = { node };

      if (this._config.username && this._config.password) {
        clientOptions.auth = {
          username: this._config.username,
          password: this._config.password
        };
      }

      if (this._config.ssl) {
        clientOptions.tls = {
          rejectUnauthorized: false
        };
      }

      this.client = new Client(clientOptions);
      await this.client.ping();
      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(`Failed to connect to Elasticsearch: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this._connected = false;
  }

  async executeQuery(query: string): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      // Try parsing as JSON for Elasticsearch DSL query
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(query);
      } catch {
        // Not JSON, treat as SQL
      }

      if (parsed && typeof parsed === 'object') {
        // Elasticsearch DSL query
        const index = parsed.index as string || '_all';
        const body = parsed.body || parsed.query ? { query: parsed.query } : parsed;

        const response = await this.client.search({
          index,
          body: body as Record<string, unknown>
        });

        const hits = (response.hits?.hits || []) as Array<Record<string, unknown>>;
        const rows = hits.map((hit: Record<string, unknown>) => ({
          _id: hit._id,
          _index: hit._index,
          _score: hit._score,
          ...(hit._source as Record<string, unknown> || {})
        }));

        const columns = this.inferColumns(rows);

        return {
          columns,
          rows,
          rowCount: rows.length,
          executionTime: Date.now() - startTime
        };
      } else {
        // SQL query via SQL API
        const response = await this.client.sql.query({ query });

        const sqlColumns = (response.columns || []) as Array<{ name: string; type: string }>;
        const sqlRows = (response.rows || []) as unknown[][];

        const columns: IColumn[] = sqlColumns.map(col => ({
          name: col.name,
          type: col.type,
          nullable: true,
          primaryKey: false
        }));

        const rows: Record<string, unknown>[] = sqlRows.map(row => {
          const obj: Record<string, unknown> = {};
          sqlColumns.forEach((col, i) => {
            obj[col.name] = row[i];
          });
          return obj;
        });

        return {
          columns,
          rows,
          rowCount: rows.length,
          executionTime: Date.now() - startTime
        };
      }
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

  async getTables(): Promise<ITable[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const response = await this.client.cat.indices({ format: 'json' }) as Array<Record<string, unknown>>;

    const tables: ITable[] = [];

    for (const index of response) {
      const indexName = (index.index || index['idx']) as string;
      if (!indexName || indexName.startsWith('.')) {
        continue; // Skip system indices
      }

      tables.push({
        name: indexName,
        columns: [],
        indexes: [],
        foreignKeys: [],
        rowCount: Number(index['docs.count']) || 0
      });
    }

    return tables;
  }

  async getColumns(table: string): Promise<IColumn[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    try {
      const response = await this.client.indices.getMapping({ index: table });
      const mappings = response[table]?.mappings || response[Object.keys(response)[0]]?.mappings;

      if (!mappings || !mappings.properties) {
        return [{ name: '_id', type: 'keyword', nullable: false, primaryKey: true }];
      }

      const columns: IColumn[] = [
        { name: '_id', type: 'keyword', nullable: false, primaryKey: true }
      ];

      this.extractMappingFields(mappings.properties as Record<string, Record<string, unknown>>, '', columns);

      return columns;
    } catch (error) {
      return [{ name: '_id', type: 'keyword', nullable: false, primaryKey: true }];
    }
  }

  async getIndexes(table: string): Promise<IIndex[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    try {
      const response = await this.client.cat.aliases({ format: 'json' }) as Array<Record<string, unknown>>;

      return response
        .filter(alias => alias.index === table)
        .map(alias => ({
          name: alias.alias as string || 'unnamed',
          columns: [alias.index as string],
          unique: false
        }));
    } catch {
      return [];
    }
  }

  async getSchema(): Promise<ISchema> {
    const tables = await this.getTables();

    for (const table of tables) {
      table.columns = await this.getColumns(table.name);
    }

    return {
      databases: [
        {
          name: 'default',
          tables,
          views: []
        }
      ]
    };
  }

  async getDatabases(): Promise<string[]> {
    return ['default'];
  }

  async getPrimaryKey(_table: string): Promise<string[]> {
    return ['_id'];
  }

  async getVersion(): Promise<string> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const info = await this.client.info();
    return (info.version?.number as string) || 'Unknown';
  }

  async getTableData(table: string, options?: { limit?: number; offset?: number }): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const response = await this.client.search({
        index: table,
        size: options?.limit || 100,
        from: options?.offset || 0
      });

      const hits = (response.hits?.hits || []) as Array<Record<string, unknown>>;
      const rows = hits.map((hit: Record<string, unknown>) => ({
        _id: hit._id,
        _index: hit._index,
        _score: hit._score,
        ...(hit._source as Record<string, unknown> || {})
      }));

      const columns = this.inferColumns(rows);

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

  async insertRow(table: string, data: Record<string, unknown>): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const response = await this.client.index({
        index: table,
        document: data
      });

      return {
        columns: [],
        rows: [{ _id: response._id, result: response.result }],
        rowCount: 0,
        affectedRows: 1,
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

  async deleteRow(table: string, where: Record<string, unknown>): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const matchClauses = Object.entries(where).map(([field, value]) => ({
        match: { [field]: value }
      }));

      const response = await this.client.deleteByQuery({
        index: table,
        body: {
          query: {
            bool: {
              must: matchClauses
            }
          }
        }
      });

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: Number(response.deleted) || 0,
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

  async updateRow(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const matchClauses = Object.entries(where).map(([field, value]) => ({
        match: { [field]: value }
      }));

      const scriptParts = Object.entries(data).map(
        ([key, _value], i) => `ctx._source['${key}'] = params.p${i}`
      );
      const scriptParams: Record<string, unknown> = {};
      Object.entries(data).forEach(([_key, value], i) => {
        scriptParams[`p${i}`] = value;
      });

      const response = await this.client.updateByQuery({
        index: table,
        body: {
          query: {
            bool: {
              must: matchClauses
            }
          },
          script: {
            source: scriptParts.join('; '),
            params: scriptParams
          }
        }
      });

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: Number(response.updated) || 0,
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

  async testConnection(): Promise<boolean> {
    try {
      const wasConnected = this._connected;
      if (!wasConnected) {
        await this.connect();
      }

      if (!this.client) {
        return false;
      }

      const result = await this.client.ping();

      if (!wasConnected) {
        await this.disconnect();
      }

      return !!result;
    } catch {
      return false;
    }
  }

  protected escapeIdentifier(identifier: string): string {
    return identifier;
  }

  protected override getTestQuery(): string {
    return 'SELECT 1';
  }

  private extractMappingFields(
    properties: Record<string, Record<string, unknown>>,
    prefix: string,
    columns: IColumn[]
  ): void {
    for (const [fieldName, fieldMapping] of Object.entries(properties)) {
      const fullName = prefix ? `${prefix}.${fieldName}` : fieldName;
      const fieldType = (fieldMapping.type as string) || 'object';

      if (fieldMapping.properties) {
        this.extractMappingFields(
          fieldMapping.properties as Record<string, Record<string, unknown>>,
          fullName,
          columns
        );
      } else {
        columns.push({
          name: fullName,
          type: fieldType,
          nullable: true,
          primaryKey: false
        });
      }
    }
  }

  private inferColumns(rows: Record<string, unknown>[]): IColumn[] {
    const columnMap = new Map<string, IColumn>();

    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (!columnMap.has(key)) {
          columnMap.set(key, {
            name: key,
            type: this.inferType(value),
            nullable: true,
            primaryKey: key === '_id'
          });
        }
      }
    }

    return Array.from(columnMap.values());
  }

  private inferType(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return 'text';
    if (typeof value === 'number') return Number.isInteger(value) ? 'long' : 'double';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'nested';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }
}
