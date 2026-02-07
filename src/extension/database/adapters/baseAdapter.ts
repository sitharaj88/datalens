import type {
  IDatabaseAdapter,
  IConnectionConfig,
  ISchema,
  ITable,
  IColumn,
  IIndex,
  IQueryResult,
  IQueryOptions
} from '../interfaces/IAdapter';
import type {
  IStoredProcedure,
  ITrigger,
  IView,
  IQueryPlan,
  IUser,
  IRole,
  ISchemaMetadata
} from '../../../shared/types/database';
import { DatabaseType } from '../../../shared/types/database';

export abstract class BaseAdapter implements IDatabaseAdapter {
  protected _config: IConnectionConfig;
  protected _connected: boolean = false;

  constructor(config: IConnectionConfig) {
    this._config = config;
  }

  get config(): IConnectionConfig {
    return this._config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract executeQuery(sql: string, params?: unknown[]): Promise<IQueryResult>;
  abstract getSchema(): Promise<ISchema>;
  abstract getTables(database?: string): Promise<ITable[]>;
  abstract getColumns(table: string, schema?: string): Promise<IColumn[]>;
  abstract getIndexes(table: string, schema?: string): Promise<IIndex[]>;
  abstract getPrimaryKey(table: string, schema?: string): Promise<string[]>;
  abstract getVersion(): Promise<string>;

  isConnected(): boolean {
    return this._connected;
  }

  async testConnection(): Promise<boolean> {
    try {
      const wasConnected = this._connected;
      if (!wasConnected) {
        await this.connect();
      }
      await this.executeQuery(this.getTestQuery());
      if (!wasConnected) {
        await this.disconnect();
      }
      return true;
    } catch {
      return false;
    }
  }

  getDatabaseType(): DatabaseType {
    return this._config.type;
  }

  async getTableData(table: string, options?: IQueryOptions): Promise<IQueryResult> {
    const sql = this.buildSelectQuery(table, options);
    return this.executeQuery(sql);
  }

  async insertRow(table: string, data: Record<string, unknown>): Promise<IQueryResult> {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = this.buildPlaceholders(values.length);

    const sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(', ')}) VALUES (${placeholders})`;

    return this.executeQuery(sql, values);
  }

  async updateRow(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<IQueryResult> {
    const setClauses: string[] = [];
    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
      setClauses.push(`${this.escapeIdentifier(key)} = ${this.getPlaceholder(paramIndex++)}`);
      values.push(value);
    }

    for (const [key, value] of Object.entries(where)) {
      whereClauses.push(`${this.escapeIdentifier(key)} = ${this.getPlaceholder(paramIndex++)}`);
      values.push(value);
    }

    const sql = `UPDATE ${this.escapeIdentifier(table)} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;

    return this.executeQuery(sql, values);
  }

  async deleteRow(table: string, where: Record<string, unknown>): Promise<IQueryResult> {
    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(where)) {
      whereClauses.push(`${this.escapeIdentifier(key)} = ${this.getPlaceholder(paramIndex++)}`);
      values.push(value);
    }

    const sql = `DELETE FROM ${this.escapeIdentifier(table)} WHERE ${whereClauses.join(' AND ')}`;

    return this.executeQuery(sql, values);
  }

  // Transaction support - default implementations
  async beginTransaction(): Promise<void> {
    await this.executeQuery('BEGIN');
  }

  async commitTransaction(): Promise<void> {
    await this.executeQuery('COMMIT');
  }

  async rollbackTransaction(): Promise<void> {
    await this.executeQuery('ROLLBACK');
  }

  // Schema objects - default implementations
  async getStoredProcedures(_database?: string): Promise<IStoredProcedure[]> {
    return [];
  }

  async getTriggers(_table?: string, _schema?: string): Promise<ITrigger[]> {
    return [];
  }

  async getViews(_database?: string): Promise<IView[]> {
    return [];
  }

  async getViewDefinition(_viewName: string, _schema?: string): Promise<string> {
    return '';
  }

  // Query plan - default implementation
  async explainQuery(sql: string): Promise<IQueryPlan> {
    const result = await this.executeQuery(`EXPLAIN ${sql}`);
    return {
      plan: result.rows,
      textRepresentation: result.rows.map(r => Object.values(r).join(' ')).join('\n')
    };
  }

  // User management - default implementations
  async getUsers(): Promise<IUser[]> {
    return [];
  }

  async getRoles(): Promise<IRole[]> {
    return [];
  }

  // Database introspection
  async getDatabases(): Promise<string[]> {
    return [this._config.database];
  }

  async getSchemas(_database?: string): Promise<string[]> {
    return ['public'];
  }

  // Schema metadata for autocomplete
  async getSchemaMetadata(database?: string): Promise<ISchemaMetadata> {
    const tables = await this.getTables(database);
    const tableMetadata = await Promise.all(
      tables.map(async (t) => {
        const cols = await this.getColumns(t.name).catch(() => []);
        return {
          name: t.name,
          schema: t.schema,
          columns: cols.map(c => ({ name: c.name, type: c.type }))
        };
      })
    );

    let views: IView[] = [];
    try {
      views = await this.getViews(database);
    } catch { /* views not supported */ }

    return {
      tables: tableMetadata,
      views: views.map(v => ({ name: v.name, schema: v.schema, columns: [] })),
      functions: [],
      keywords: []
    };
  }

  protected buildSelectQuery(table: string, options?: IQueryOptions): string {
    let sql = `SELECT * FROM ${this.escapeIdentifier(table)}`;

    if (options?.where && Object.keys(options.where).length > 0) {
      const whereClauses = Object.entries(options.where).map(
        ([key, value]) => `${this.escapeIdentifier(key)} = ${this.escapeValue(value)}`
      );
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    if (options?.orderBy && options.orderBy.length > 0) {
      const orderClauses = options.orderBy.map(
        o => `${this.escapeIdentifier(o.column)} ${o.direction}`
      );
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }

    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    if (options?.offset) {
      sql += ` OFFSET ${options.offset}`;
    }

    return sql;
  }

  protected abstract escapeIdentifier(identifier: string): string;

  protected escapeValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  protected getTestQuery(): string {
    return 'SELECT 1';
  }

  protected getPlaceholder(index: number): string {
    return `$${index}`;
  }

  protected buildPlaceholders(count: number): string {
    return Array.from({ length: count }, (_, i) => this.getPlaceholder(i + 1)).join(', ');
  }

  protected measureTime<T>(fn: () => T): { result: T; time: number } {
    const start = Date.now();
    const result = fn();
    return { result, time: Date.now() - start };
  }

  protected async measureTimeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; time: number }> {
    const start = Date.now();
    const result = await fn();
    return { result, time: Date.now() - start };
  }
}
