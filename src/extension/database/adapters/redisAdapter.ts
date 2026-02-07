import Redis from 'ioredis';
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

export class RedisAdapter extends BaseAdapter implements IDatabaseAdapter {
  private client: Redis | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.client) {
      return;
    }

    try {
      this.client = new Redis({
        host: this._config.host || 'localhost',
        port: this._config.port || 6379,
        password: this._config.password || undefined,
        db: parseInt(this._config.database, 10) || 0,
        lazyConnect: true,
        connectTimeout: 10000
      });

      await this.client.connect();
      this._connected = true;
    } catch (error) {
      this._connected = false;
      if (this.client) {
        this.client.disconnect();
        this.client = null;
      }
      throw new Error(`Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
    this._connected = false;
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
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async executeQuery(command: string, _params?: unknown[]): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to Redis');
    }

    const startTime = Date.now();

    try {
      const parts = this.parseCommand(command);
      if (parts.length === 0) {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          executionTime: Date.now() - startTime,
          error: 'Empty command'
        };
      }

      const cmd = parts[0].toUpperCase();
      const args = parts.slice(1);

      const result = await (this.client as unknown as Record<string, (...a: string[]) => Promise<unknown>>).call(cmd, ...args);

      const { columns, rows } = this.formatResult(cmd, result);

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
    if (!this.client) {
      throw new Error('Not connected to Redis');
    }

    const prefixes = new Set<string>();
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH', '*',
        'COUNT', '100'
      );
      cursor = nextCursor;

      for (const key of keys) {
        const colonIndex = key.indexOf(':');
        if (colonIndex > 0) {
          prefixes.add(key.substring(0, colonIndex));
        } else {
          prefixes.add(key);
        }
      }
    } while (cursor !== '0');

    const tables: ITable[] = Array.from(prefixes).sort().map(prefix => ({
      name: prefix,
      schema: database || this._config.database,
      columns: [],
      indexes: [],
      foreignKeys: []
    }));

    return tables;
  }

  async getColumns(table: string, _schema?: string): Promise<IColumn[]> {
    if (!this.client) {
      throw new Error('Not connected to Redis');
    }

    try {
      const keyType = await this.client.type(table);

      switch (keyType) {
        case 'string':
          return [
            { name: 'key', type: 'string', nullable: false, primaryKey: true },
            { name: 'value', type: 'string', nullable: true, primaryKey: false }
          ];
        case 'hash':
          return [
            { name: 'field', type: 'string', nullable: false, primaryKey: true },
            { name: 'value', type: 'string', nullable: true, primaryKey: false }
          ];
        case 'list':
          return [
            { name: 'index', type: 'integer', nullable: false, primaryKey: true },
            { name: 'value', type: 'string', nullable: true, primaryKey: false }
          ];
        case 'set':
          return [
            { name: 'member', type: 'string', nullable: false, primaryKey: true }
          ];
        case 'zset':
          return [
            { name: 'member', type: 'string', nullable: false, primaryKey: true },
            { name: 'score', type: 'float', nullable: false, primaryKey: false }
          ];
        default:
          return [
            { name: 'key', type: 'string', nullable: false, primaryKey: true },
            { name: 'value', type: 'string', nullable: true, primaryKey: false }
          ];
      }
    } catch {
      return [
        { name: 'key', type: 'string', nullable: false, primaryKey: true },
        { name: 'value', type: 'string', nullable: true, primaryKey: false }
      ];
    }
  }

  async getTableData(table: string, options?: IQueryOptions): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to Redis');
    }

    const startTime = Date.now();

    try {
      const pattern = table.includes('*') ? table : `${table}*`;
      const keys: string[] = [];
      let cursor = '0';

      do {
        const [nextCursor, foundKeys] = await this.client.scan(
          cursor,
          'MATCH', pattern,
          'COUNT', '100'
        );
        cursor = nextCursor;
        keys.push(...foundKeys);
      } while (cursor !== '0');

      const limit = options?.limit || 100;
      const offset = options?.offset || 0;
      const selectedKeys = keys.sort().slice(offset, offset + limit);

      const rows: Record<string, unknown>[] = [];
      for (const key of selectedKeys) {
        const keyType = await this.client.type(key);
        let value: unknown;

        switch (keyType) {
          case 'string':
            value = await this.client.get(key);
            break;
          case 'hash':
            value = await this.client.hgetall(key);
            break;
          case 'list':
            value = await this.client.lrange(key, 0, -1);
            break;
          case 'set':
            value = await this.client.smembers(key);
            break;
          case 'zset':
            value = await this.client.zrange(key, 0, -1, 'WITHSCORES');
            break;
          default:
            value = null;
        }

        rows.push({
          key,
          type: keyType,
          value: typeof value === 'object' ? JSON.stringify(value) : value
        });
      }

      const columns: IColumn[] = [
        { name: 'key', type: 'string', nullable: false, primaryKey: true },
        { name: 'type', type: 'string', nullable: false, primaryKey: false },
        { name: 'value', type: 'string', nullable: true, primaryKey: false }
      ];

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

  async getSchema(): Promise<ISchema> {
    const tables = await this.getTables();

    return {
      databases: [
        {
          name: this._config.database || '0',
          tables,
          views: []
        }
      ]
    };
  }

  async getDatabases(): Promise<string[]> {
    return ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
  }

  async getIndexes(_table: string, _schema?: string): Promise<IIndex[]> {
    return [];
  }

  async getPrimaryKey(_table: string, _schema?: string): Promise<string[]> {
    return ['key'];
  }

  async getVersion(): Promise<string> {
    if (!this.client) {
      throw new Error('Not connected to Redis');
    }

    try {
      const info = await this.client.info('server');
      const versionMatch = info.match(/redis_version:([^\r\n]+)/);
      return versionMatch ? `Redis ${versionMatch[1]}` : 'Redis (unknown version)';
    } catch {
      return 'Redis (unknown version)';
    }
  }

  async insertRow(table: string, data: Record<string, unknown>): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to Redis');
    }

    const startTime = Date.now();

    try {
      const keys = Object.keys(data);

      if (keys.length === 1 && keys[0] === 'value') {
        // Simple string SET
        await this.client.set(table, String(data.value));
      } else if (keys.length === 2 && keys.includes('key') && keys.includes('value')) {
        // String SET with explicit key
        const key = String(data.key);
        await this.client.set(key, String(data.value));
      } else {
        // Hash HSET for multiple fields
        const hashData: Record<string, string> = {};
        for (const [field, value] of Object.entries(data)) {
          hashData[field] = String(value);
        }
        await this.client.hset(table, hashData);
      }

      return {
        columns: [],
        rows: [],
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

  async updateRow(
    table: string,
    data: Record<string, unknown>,
    _where: Record<string, unknown>
  ): Promise<IQueryResult> {
    // In Redis, update is the same as insert (SET overwrites)
    return this.insertRow(table, data);
  }

  async deleteRow(table: string, where: Record<string, unknown>): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to Redis');
    }

    const startTime = Date.now();

    try {
      const key = (where.key as string) || table;
      const deleted = await this.client.del(key);

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: deleted,
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

  protected escapeIdentifier(identifier: string): string {
    return identifier;
  }

  protected override getTestQuery(): string {
    return 'PING';
  }

  private parseCommand(command: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        if (current.length > 0) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.length > 0) {
      parts.push(current);
    }

    return parts;
  }

  private formatResult(
    command: string,
    result: unknown
  ): { columns: IColumn[]; rows: Record<string, unknown>[] } {
    if (result === null || result === undefined) {
      return {
        columns: [
          { name: 'value', type: 'string', nullable: true, primaryKey: false }
        ],
        rows: [{ value: '(nil)' }]
      };
    }

    if (typeof result === 'string' || typeof result === 'number') {
      return {
        columns: [
          { name: 'value', type: 'string', nullable: false, primaryKey: false }
        ],
        rows: [{ value: result }]
      };
    }

    if (Array.isArray(result)) {
      // Handle HGETALL-style results (alternating key/value)
      if (['HGETALL', 'CONFIG', 'ZRANGE'].includes(command) && result.length % 2 === 0 && result.length > 0) {
        const rows: Record<string, unknown>[] = [];
        for (let i = 0; i < result.length; i += 2) {
          rows.push({ key: result[i], value: result[i + 1] });
        }
        return {
          columns: [
            { name: 'key', type: 'string', nullable: false, primaryKey: true },
            { name: 'value', type: 'string', nullable: true, primaryKey: false }
          ],
          rows
        };
      }

      // Regular array results (KEYS, SMEMBERS, LRANGE, etc.)
      return {
        columns: [
          { name: 'value', type: 'string', nullable: false, primaryKey: false }
        ],
        rows: result.map(item => ({ value: item }))
      };
    }

    if (typeof result === 'object') {
      const entries = Object.entries(result as Record<string, unknown>);
      return {
        columns: [
          { name: 'key', type: 'string', nullable: false, primaryKey: true },
          { name: 'value', type: 'string', nullable: true, primaryKey: false }
        ],
        rows: entries.map(([key, value]) => ({ key, value }))
      };
    }

    return {
      columns: [
        { name: 'value', type: 'string', nullable: false, primaryKey: false }
      ],
      rows: [{ value: String(result) }]
    };
  }
}
