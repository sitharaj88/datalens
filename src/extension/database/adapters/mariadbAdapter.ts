import mysql, { type Pool, type PoolOptions, type RowDataPacket, type FieldPacket, type ResultSetHeader } from 'mysql2/promise';
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

export class MariaDBAdapter extends BaseAdapter implements IDatabaseAdapter {
  private pool: Pool | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.pool) {
      return;
    }

    const poolConfig: PoolOptions = {
      host: this._config.host || 'localhost',
      port: this._config.port || 3306,
      database: this._config.database,
      user: this._config.username,
      password: this._config.password,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };

    if (this._config.ssl) {
      poolConfig.ssl = typeof this._config.ssl === 'boolean'
        ? { rejectUnauthorized: false }
        : this._config.ssl as Record<string, unknown>;
    }

    try {
      this.pool = mysql.createPool(poolConfig);
      const connection = await this.pool.getConnection();
      connection.release();
      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(`Failed to connect to MariaDB: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this._connected = false;
  }

  async executeQuery(sql: string, params?: unknown[]): Promise<IQueryResult> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const [rows, fields] = await this.pool.query<RowDataPacket[] | ResultSetHeader>(sql, params);

      if (Array.isArray(rows)) {
        const columns: IColumn[] = (fields as FieldPacket[])?.map(field => ({
          name: field.name,
          type: this.getTypeName(field.type || 0),
          nullable: true,
          primaryKey: (field.flags || 0) & 2 ? true : false
        })) || [];

        return {
          columns,
          rows: rows as Record<string, unknown>[],
          rowCount: rows.length,
          executionTime: Date.now() - startTime
        };
      } else {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: rows.affectedRows,
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

  async getSchema(): Promise<ISchema> {
    const databases = await this.getDatabases();
    const dbEntries = await Promise.all(
      databases.map(async (dbName) => {
        const tables = await this.getTables(dbName);
        const views = await this.getViews(dbName);
        return { name: dbName, tables, views };
      })
    );

    return { databases: dbEntries };
  }

  async getTables(database?: string): Promise<ITable[]> {
    const db = database || this._config.database;

    const result = await this.executeQuery(`
      SELECT TABLE_NAME, TABLE_ROWS
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `, [db]);

    const tables: ITable[] = [];
    for (const row of result.rows) {
      const tableName = row.TABLE_NAME as string;
      const columns = await this.getColumns(tableName, db);
      const indexes = await this.getIndexes(tableName, db);
      const foreignKeys = await this.getForeignKeys(tableName, db);
      const rowCount = row.TABLE_ROWS as number | undefined;

      tables.push({
        name: tableName,
        schema: db,
        columns,
        indexes,
        foreignKeys,
        rowCount: rowCount ?? 0
      });
    }

    return tables;
  }

  async getColumns(table: string, schema?: string): Promise<IColumn[]> {
    const db = schema || this._config.database;

    const result = await this.executeQuery(`
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        COLUMN_KEY,
        EXTRA
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [db, table]);

    return result.rows.map(row => ({
      name: row.COLUMN_NAME as string,
      type: row.DATA_TYPE as string,
      nullable: (row.IS_NULLABLE as string) === 'YES',
      primaryKey: (row.COLUMN_KEY as string) === 'PRI',
      defaultValue: row.COLUMN_DEFAULT,
      autoIncrement: String(row.EXTRA || '').includes('auto_increment')
    }));
  }

  async getIndexes(table: string, schema?: string): Promise<IIndex[]> {
    const db = schema || this._config.database;

    const result = await this.executeQuery(
      `SHOW INDEX FROM ${this.escapeIdentifier(db)}.${this.escapeIdentifier(table)}`
    );

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>();

    for (const row of result.rows) {
      const indexName = row.Key_name as string;
      if (indexName === 'PRIMARY') {
        continue;
      }
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          name: indexName,
          columns: [],
          unique: (row.Non_unique as number) === 0
        });
      }
      indexMap.get(indexName)!.columns.push(row.Column_name as string);
    }

    return Array.from(indexMap.values());
  }

  async getPrimaryKey(table: string, schema?: string): Promise<string[]> {
    const db = schema || this._config.database;

    const result = await this.executeQuery(`
      SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'
      ORDER BY ORDINAL_POSITION
    `, [db, table]);

    return result.rows.map(row => row.COLUMN_NAME as string);
  }

  async getVersion(): Promise<string> {
    const result = await this.executeQuery('SELECT VERSION() as version');
    const version = (result.rows[0]?.version as string) || 'Unknown';
    return `MariaDB ${version}`;
  }

  async getDatabases(): Promise<string[]> {
    const result = await this.executeQuery('SHOW DATABASES');
    return result.rows.map(row => {
      const values = Object.values(row);
      return values[0] as string;
    });
  }

  async getStoredProcedures(database?: string): Promise<IStoredProcedure[]> {
    const db = database || this._config.database;

    const result = await this.executeQuery(`
      SELECT ROUTINE_NAME, ROUTINE_SCHEMA, ROUTINE_TYPE, ROUTINE_DEFINITION
      FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ?
    `, [db]);

    return result.rows.map(row => ({
      name: row.ROUTINE_NAME as string,
      schema: row.ROUTINE_SCHEMA as string,
      definition: row.ROUTINE_DEFINITION as string | undefined,
      returnType: row.ROUTINE_TYPE as string | undefined
    }));
  }

  async getTriggers(table?: string, schema?: string): Promise<ITrigger[]> {
    const db = schema || this._config.database;

    let sql = `
      SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT
      FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = ?
    `;
    const params: unknown[] = [db];

    if (table) {
      sql += ' AND EVENT_OBJECT_TABLE = ?';
      params.push(table);
    }

    const result = await this.executeQuery(sql, params);

    return result.rows.map(row => ({
      name: row.TRIGGER_NAME as string,
      table: row.EVENT_OBJECT_TABLE as string,
      event: row.EVENT_MANIPULATION as string,
      timing: row.ACTION_TIMING as string,
      definition: row.ACTION_STATEMENT as string | undefined,
      enabled: true
    }));
  }

  async getViews(database?: string): Promise<IView[]> {
    const db = database || this._config.database;

    const result = await this.executeQuery(`
      SELECT TABLE_NAME, VIEW_DEFINITION
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `, [db]);

    return result.rows.map(row => ({
      name: row.TABLE_NAME as string,
      schema: db,
      definition: row.VIEW_DEFINITION as string | undefined
    }));
  }

  async getSchemas(database?: string): Promise<string[]> {
    return this.getDatabases();
  }

  async getViewDefinition(viewName: string, schema?: string): Promise<string> {
    const db = schema || this._config.database;

    const result = await this.executeQuery(`
      SELECT VIEW_DEFINITION
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `, [db, viewName]);

    return (result.rows[0]?.VIEW_DEFINITION as string) || '';
  }

  async getUsers(): Promise<IUser[]> {
    const result = await this.executeQuery('SELECT User, Host FROM mysql.user');

    return result.rows.map(row => ({
      name: `${row.User}@${row.Host}`,
      canLogin: true
    }));
  }

  async getRoles(): Promise<IRole[]> {
    try {
      const result = await this.executeQuery(
        'SELECT DISTINCT User as role_name FROM mysql.user WHERE account_locked = "Y" AND password_expired = "Y"'
      );
      return result.rows.map(row => ({
        name: row.role_name as string,
        privileges: []
      }));
    } catch {
      return [];
    }
  }

  async explainQuery(sql: string): Promise<IQueryPlan> {
    const result = await this.executeQuery(`EXPLAIN FORMAT=JSON ${sql}`);

    let plan: unknown = result.rows;
    let textRepresentation = '';

    try {
      if (result.rows.length > 0) {
        const firstRow = result.rows[0];
        const jsonStr = firstRow.EXPLAIN || firstRow.explain || Object.values(firstRow)[0];
        if (typeof jsonStr === 'string') {
          plan = JSON.parse(jsonStr);
          textRepresentation = JSON.stringify(plan, null, 2);
        } else {
          plan = jsonStr;
          textRepresentation = JSON.stringify(plan, null, 2);
        }
      }
    } catch {
      textRepresentation = result.rows.map(r => Object.values(r).join(' ')).join('\n');
    }

    return {
      plan,
      textRepresentation
    };
  }

  private async getForeignKeys(table: string, database?: string): Promise<Array<{
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete?: string;
    onUpdate?: string;
  }>> {
    const db = database || this._config.database;

    const result = await this.executeQuery(`
      SELECT
        CONSTRAINT_NAME,
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
    `, [db, table]);

    const fkMap = new Map<string, {
      name: string;
      columns: string[];
      referencedTable: string;
      referencedColumns: string[];
    }>();

    for (const row of result.rows) {
      const name = row.CONSTRAINT_NAME as string;
      if (!fkMap.has(name)) {
        fkMap.set(name, {
          name,
          columns: [],
          referencedTable: row.REFERENCED_TABLE_NAME as string,
          referencedColumns: []
        });
      }
      const fk = fkMap.get(name)!;
      fk.columns.push(row.COLUMN_NAME as string);
      fk.referencedColumns.push(row.REFERENCED_COLUMN_NAME as string);
    }

    return Array.from(fkMap.values());
  }

  protected escapeIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  protected override getPlaceholder(_index: number): string {
    return '?';
  }

  protected override buildPlaceholders(count: number): string {
    return Array(count).fill('?').join(', ');
  }

  private getTypeName(typeId: number): string {
    const typeMap: Record<number, string> = {
      0: 'decimal',
      1: 'tinyint',
      2: 'smallint',
      3: 'int',
      4: 'float',
      5: 'double',
      7: 'timestamp',
      8: 'bigint',
      9: 'mediumint',
      10: 'date',
      11: 'time',
      12: 'datetime',
      13: 'year',
      15: 'varchar',
      245: 'json',
      246: 'decimal',
      252: 'blob',
      253: 'varchar',
      254: 'char'
    };
    return typeMap[typeId] || 'unknown';
  }
}
