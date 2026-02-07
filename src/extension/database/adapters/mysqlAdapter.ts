import mysql, { type Pool, type PoolOptions, type RowDataPacket, type FieldPacket, type ResultSetHeader } from 'mysql2/promise';
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
  IStoredProcedure,
  ITrigger,
  IView,
  IQueryPlan,
  IUser,
  IRole
} from '../../../shared/types/database';

export class MySQLAdapter extends BaseAdapter {
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
      throw new Error(`Failed to connect to MySQL: ${error instanceof Error ? error.message : String(error)}`);
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
    const tables = await this.getTables();
    const views = await this.getViews();

    return {
      databases: [
        {
          name: this._config.database,
          tables,
          views
        }
      ]
    };
  }

  async getTables(): Promise<ITable[]> {
    const result = await this.executeQuery(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `, [this._config.database]);

    const tables: ITable[] = [];
    for (const row of result.rows) {
      const tableName = row.TABLE_NAME as string;
      const columns = await this.getColumns(tableName);
      const indexes = await this.getIndexes(tableName);
      const foreignKeys = await this.getForeignKeys(tableName);
      const rowCount = await this.getTableRowCount(tableName);

      tables.push({
        name: tableName,
        columns,
        indexes,
        foreignKeys,
        rowCount
      });
    }

    return tables;
  }

  async getViews(): Promise<IView[]> {
    const result = await this.executeQuery(`
      SELECT TABLE_NAME, VIEW_DEFINITION
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `, [this._config.database]);

    return result.rows.map(row => ({
      name: row.TABLE_NAME as string,
      schema: this._config.database,
      definition: row.VIEW_DEFINITION as string | undefined
    }));
  }

  async getViewDefinition(viewName: string, _schema?: string): Promise<string> {
    const result = await this.executeQuery(`
      SELECT VIEW_DEFINITION
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `, [_schema || this._config.database, viewName]);

    return (result.rows[0]?.VIEW_DEFINITION as string) || '';
  }

  async getColumns(table: string): Promise<IColumn[]> {
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
    `, [this._config.database, table]);

    return result.rows.map(row => ({
      name: row.COLUMN_NAME as string,
      type: row.DATA_TYPE as string,
      nullable: (row.IS_NULLABLE as string) === 'YES',
      primaryKey: (row.COLUMN_KEY as string) === 'PRI',
      defaultValue: row.COLUMN_DEFAULT,
      autoIncrement: String(row.EXTRA || '').includes('auto_increment')
    }));
  }

  async getIndexes(table: string): Promise<IIndex[]> {
    const result = await this.executeQuery(`
      SELECT
        INDEX_NAME,
        GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns,
        NOT NON_UNIQUE as is_unique
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME != 'PRIMARY'
      GROUP BY INDEX_NAME, NON_UNIQUE
      ORDER BY INDEX_NAME
    `, [this._config.database, table]);

    return result.rows.map(row => ({
      name: row.INDEX_NAME as string,
      columns: (row.columns as string).split(','),
      unique: Boolean(row.is_unique)
    }));
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    const result = await this.executeQuery(`
      SELECT COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
    `, [this._config.database, table]);

    return result.rows.map(row => row.COLUMN_NAME as string);
  }

  private async getForeignKeys(table: string): Promise<Array<{
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete?: string;
    onUpdate?: string;
  }>> {
    const result = await this.executeQuery(`
      SELECT
        CONSTRAINT_NAME,
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
    `, [this._config.database, table]);

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

  private async getTableRowCount(table: string): Promise<number> {
    const result = await this.executeQuery(
      `SELECT COUNT(*) as count FROM ${this.escapeIdentifier(table)}`
    );
    return Number(result.rows[0]?.count) || 0;
  }

  async getVersion(): Promise<string> {
    const result = await this.executeQuery('SELECT VERSION() as version');
    return (result.rows[0]?.version as string) || 'Unknown';
  }

  async explainQuery(sql: string): Promise<IQueryPlan> {
    const result = await this.executeQuery(`EXPLAIN FORMAT=JSON ${sql}`);

    let plan: unknown = result.rows;
    let textRepresentation = '';
    let estimatedCost: number | undefined;

    try {
      if (result.rows.length > 0) {
        const firstRow = result.rows[0];
        const jsonStr = firstRow.EXPLAIN || firstRow.explain || Object.values(firstRow)[0];
        if (typeof jsonStr === 'string') {
          const parsed = JSON.parse(jsonStr);
          plan = parsed;
          if (parsed?.query_block?.cost_info?.query_cost) {
            estimatedCost = parseFloat(parsed.query_block.cost_info.query_cost);
          }
        }
        textRepresentation = JSON.stringify(plan, null, 2);
      }
    } catch {
      const textResult = await this.executeQuery(`EXPLAIN ${sql}`);
      textRepresentation = textResult.rows.map(r => Object.values(r).join(' | ')).join('\n');
      plan = textResult.rows;
    }

    return { plan, textRepresentation, estimatedCost };
  }

  async getDatabases(): Promise<string[]> {
    const result = await this.executeQuery('SHOW DATABASES');
    return result.rows.map(row => (row.Database || Object.values(row)[0]) as string);
  }

  async getSchemas(_database?: string): Promise<string[]> {
    return this.getDatabases();
  }

  async getStoredProcedures(): Promise<IStoredProcedure[]> {
    const result = await this.executeQuery(`
      SELECT ROUTINE_NAME, ROUTINE_SCHEMA, ROUTINE_TYPE, DATA_TYPE
      FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ?
      ORDER BY ROUTINE_NAME
    `, [this._config.database]);

    return result.rows.map(row => ({
      name: row.ROUTINE_NAME as string,
      schema: row.ROUTINE_SCHEMA as string,
      returnType: row.ROUTINE_TYPE === 'FUNCTION' ? (row.DATA_TYPE as string) : undefined
    }));
  }

  async getTriggers(_table?: string): Promise<ITrigger[]> {
    let sql = `
      SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION,
             ACTION_TIMING, ACTION_STATEMENT
      FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = ?
    `;
    const params: unknown[] = [this._config.database];

    if (_table) {
      sql += ' AND EVENT_OBJECT_TABLE = ?';
      params.push(_table);
    }

    sql += ' ORDER BY TRIGGER_NAME';

    const result = await this.executeQuery(sql, params);

    return result.rows.map(row => ({
      name: row.TRIGGER_NAME as string,
      table: row.EVENT_OBJECT_TABLE as string,
      event: row.EVENT_MANIPULATION as string,
      timing: row.ACTION_TIMING as string,
      enabled: true
    }));
  }

  async getUsers(): Promise<IUser[]> {
    const result = await this.executeQuery(
      "SELECT User, Host FROM mysql.user ORDER BY User"
    );

    return result.rows.map(row => ({
      name: `${row.User}@${row.Host}`,
      canLogin: true
    }));
  }

  async getRoles(): Promise<IRole[]> {
    try {
      const result = await this.executeQuery('SELECT DISTINCT User as role_name FROM mysql.user WHERE account_locked = "Y" AND password_expired = "Y"');
      return result.rows.map(row => ({
        name: row.role_name as string,
        privileges: []
      }));
    } catch {
      return [];
    }
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
