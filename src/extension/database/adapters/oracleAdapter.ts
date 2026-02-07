import oracledb from 'oracledb';
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
  IRole,
  ISchemaMetadata
} from '../../../shared/types/database';
import { DatabaseType } from '../../../shared/types/database';

export class OracleAdapter extends BaseAdapter {
  private connection: oracledb.Connection | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.connection) {
      return;
    }

    try {
      const connectString = this._config.connectionString
        || `${this._config.host || 'localhost'}:${this._config.port || 1521}/${this._config.database}`;

      this.connection = await oracledb.getConnection({
        user: this._config.username,
        password: this._config.password,
        connectString
      });

      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(`Failed to connect to Oracle: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
    this._connected = false;
  }

  async executeQuery(sql: string, params?: unknown[]): Promise<IQueryResult> {
    if (!this.connection) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const result = await this.connection.execute(
        sql,
        params || [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const columns: IColumn[] = (result.metaData || []).map((meta: oracledb.Metadata) => ({
        name: meta.name,
        type: this.mapOracleType(meta.dbType),
        nullable: meta.nullable !== false,
        primaryKey: false
      }));

      const rows = (result.rows || []) as Record<string, unknown>[];

      return {
        columns,
        rows,
        rowCount: rows.length,
        affectedRows: result.rowsAffected,
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
    const owner = this._config.username?.toUpperCase() || '';

    const result = await this.executeQuery(
      `SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :owner ORDER BY TABLE_NAME`,
      [owner]
    );

    const tables: ITable[] = [];

    for (const row of result.rows) {
      const tableName = row.TABLE_NAME as string;
      const columns = await this.getColumns(tableName);
      const indexes = await this.getIndexes(tableName);
      const foreignKeys = await this.getForeignKeys(tableName);

      tables.push({
        name: tableName,
        schema: owner,
        columns,
        indexes,
        foreignKeys
      });
    }

    return tables;
  }

  async getColumns(table: string, schema?: string): Promise<IColumn[]> {
    const owner = (schema || this._config.username || '').toUpperCase();

    const result = await this.executeQuery(
      `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
       FROM ALL_TAB_COLUMNS
       WHERE TABLE_NAME = :table AND OWNER = :owner
       ORDER BY COLUMN_ID`,
      [table.toUpperCase(), owner]
    );

    // Get primary key columns for this table
    const pkColumns = await this.getPrimaryKey(table, schema);
    const pkSet = new Set(pkColumns.map(c => c.toUpperCase()));

    return result.rows.map(row => ({
      name: row.COLUMN_NAME as string,
      type: row.DATA_TYPE as string,
      nullable: (row.NULLABLE as string) === 'Y',
      primaryKey: pkSet.has((row.COLUMN_NAME as string).toUpperCase()),
      defaultValue: row.DATA_DEFAULT ?? undefined
    }));
  }

  async getIndexes(table: string, schema?: string): Promise<IIndex[]> {
    const owner = (schema || this._config.username || '').toUpperCase();

    const result = await this.executeQuery(
      `SELECT i.INDEX_NAME, ic.COLUMN_NAME, i.UNIQUENESS
       FROM ALL_INDEXES i
       JOIN ALL_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER
       WHERE i.TABLE_NAME = :table AND i.OWNER = :owner
       ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION`,
      [table.toUpperCase(), owner]
    );

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>();

    for (const row of result.rows) {
      const indexName = row.INDEX_NAME as string;
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          name: indexName,
          columns: [],
          unique: (row.UNIQUENESS as string) === 'UNIQUE'
        });
      }
      indexMap.get(indexName)!.columns.push(row.COLUMN_NAME as string);
    }

    return Array.from(indexMap.values());
  }

  async getPrimaryKey(table: string, schema?: string): Promise<string[]> {
    const owner = (schema || this._config.username || '').toUpperCase();

    const result = await this.executeQuery(
      `SELECT cols.COLUMN_NAME
       FROM ALL_CONSTRAINTS cons
       JOIN ALL_CONS_COLUMNS cols ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND cons.OWNER = cols.OWNER
       WHERE cons.TABLE_NAME = :table
         AND cons.OWNER = :owner
         AND cons.CONSTRAINT_TYPE = 'P'
       ORDER BY cols.POSITION`,
      [table.toUpperCase(), owner]
    );

    return result.rows.map(row => row.COLUMN_NAME as string);
  }

  async getVersion(): Promise<string> {
    const result = await this.executeQuery('SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1');

    if (result.rows.length > 0) {
      return result.rows[0].BANNER as string || 'Unknown';
    }

    // Fallback
    const fallback = await this.executeQuery('SELECT VERSION FROM V$INSTANCE');
    if (fallback.rows.length > 0) {
      return `Oracle ${fallback.rows[0].VERSION as string}`;
    }

    return 'Oracle (version unknown)';
  }

  async getDatabases(): Promise<string[]> {
    const result = await this.executeQuery('SELECT NAME FROM V$DATABASE');
    return result.rows.map(row => row.NAME as string);
  }

  async getSchemas(): Promise<string[]> {
    const result = await this.executeQuery(
      'SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME'
    );
    return result.rows.map(row => row.USERNAME as string);
  }

  async getStoredProcedures(): Promise<IStoredProcedure[]> {
    const owner = this._config.username?.toUpperCase() || '';

    const result = await this.executeQuery(
      `SELECT OBJECT_NAME, OBJECT_TYPE
       FROM ALL_PROCEDURES
       WHERE OWNER = :owner AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')
       ORDER BY OBJECT_NAME`,
      [owner]
    );

    return result.rows.map(row => ({
      name: row.OBJECT_NAME as string,
      schema: owner,
      returnType: (row.OBJECT_TYPE as string) === 'FUNCTION' ? 'RETURN' : undefined
    }));
  }

  async getTriggers(): Promise<ITrigger[]> {
    const owner = this._config.username?.toUpperCase() || '';

    const result = await this.executeQuery(
      `SELECT TRIGGER_NAME, TABLE_NAME, TRIGGERING_EVENT, TRIGGER_TYPE, STATUS
       FROM ALL_TRIGGERS
       WHERE OWNER = :owner
       ORDER BY TRIGGER_NAME`,
      [owner]
    );

    return result.rows.map(row => ({
      name: row.TRIGGER_NAME as string,
      table: row.TABLE_NAME as string,
      event: row.TRIGGERING_EVENT as string,
      timing: row.TRIGGER_TYPE as string,
      enabled: (row.STATUS as string) === 'ENABLED'
    }));
  }

  async getViews(): Promise<IView[]> {
    const owner = this._config.username?.toUpperCase() || '';

    const result = await this.executeQuery(
      `SELECT VIEW_NAME, TEXT
       FROM ALL_VIEWS
       WHERE OWNER = :owner
       ORDER BY VIEW_NAME`,
      [owner]
    );

    return result.rows.map(row => ({
      name: row.VIEW_NAME as string,
      schema: owner,
      definition: row.TEXT as string | undefined
    }));
  }

  async getViewDefinition(viewName: string, schema?: string): Promise<string> {
    const owner = (schema || this._config.username || '').toUpperCase();

    const result = await this.executeQuery(
      `SELECT TEXT FROM ALL_VIEWS WHERE VIEW_NAME = :viewName AND OWNER = :owner`,
      [viewName.toUpperCase(), owner]
    );

    if (result.rows.length > 0) {
      return result.rows[0].TEXT as string || '';
    }
    return '';
  }

  // Oracle transactions are implicit - override base BEGIN which doesn't work
  async beginTransaction(): Promise<void> {
    await this.executeQuery('SET TRANSACTION READ WRITE');
  }

  async getRoles(): Promise<IRole[]> {
    const result = await this.executeQuery(
      'SELECT ROLE FROM DBA_ROLES ORDER BY ROLE'
    );

    if (result.error) {
      const fallback = await this.executeQuery(
        'SELECT GRANTED_ROLE as ROLE FROM USER_ROLE_PRIVS ORDER BY GRANTED_ROLE'
      );
      return fallback.rows.map(row => ({
        name: row.ROLE as string,
        privileges: []
      }));
    }

    return result.rows.map(row => ({
      name: row.ROLE as string,
      privileges: []
    }));
  }

  async getUsers(): Promise<IUser[]> {
    const result = await this.executeQuery(
      `SELECT USERNAME, ACCOUNT_STATUS, DEFAULT_TABLESPACE
       FROM ALL_USERS
       ORDER BY USERNAME`
    );

    return result.rows.map(row => ({
      name: row.USERNAME as string,
      canLogin: !String(row.ACCOUNT_STATUS || '').includes('LOCKED')
    }));
  }

  async explainQuery(sql: string): Promise<IQueryPlan> {
    const planId = `plan_${Date.now()}`;

    // Set the statement ID and generate the plan
    await this.executeQuery(
      `EXPLAIN PLAN SET STATEMENT_ID = :planId FOR ${sql}`,
      [planId]
    );

    // Retrieve the plan
    const result = await this.executeQuery(
      `SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', :planId, 'ALL'))`,
      [planId]
    );

    const textLines = result.rows.map(row => row.PLAN_TABLE_OUTPUT as string);

    return {
      plan: result.rows,
      textRepresentation: textLines.join('\n')
    };
  }

  async getTableData(table: string, options?: { limit?: number; offset?: number; orderBy?: Array<{ column: string; direction: 'ASC' | 'DESC' }>; where?: Record<string, unknown> }): Promise<IQueryResult> {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

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

    // Oracle pagination using OFFSET/FETCH (12c+)
    sql += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    return this.executeQuery(sql);
  }

  private async getForeignKeys(table: string, schema?: string): Promise<Array<{
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete?: string;
  }>> {
    const owner = (schema || this._config.username || '').toUpperCase();

    const result = await this.executeQuery(
      `SELECT
        a.CONSTRAINT_NAME,
        a.COLUMN_NAME,
        c_pk.TABLE_NAME AS REFERENCED_TABLE,
        b.COLUMN_NAME AS REFERENCED_COLUMN,
        c.DELETE_RULE
       FROM ALL_CONS_COLUMNS a
       JOIN ALL_CONSTRAINTS c ON a.CONSTRAINT_NAME = c.CONSTRAINT_NAME AND a.OWNER = c.OWNER
       JOIN ALL_CONSTRAINTS c_pk ON c.R_CONSTRAINT_NAME = c_pk.CONSTRAINT_NAME AND c.R_OWNER = c_pk.OWNER
       JOIN ALL_CONS_COLUMNS b ON c_pk.CONSTRAINT_NAME = b.CONSTRAINT_NAME AND c_pk.OWNER = b.OWNER AND a.POSITION = b.POSITION
       WHERE c.CONSTRAINT_TYPE = 'R'
         AND a.TABLE_NAME = :table
         AND a.OWNER = :owner
       ORDER BY a.CONSTRAINT_NAME, a.POSITION`,
      [table.toUpperCase(), owner]
    );

    const fkMap = new Map<string, {
      name: string;
      columns: string[];
      referencedTable: string;
      referencedColumns: string[];
      onDelete?: string;
    }>();

    for (const row of result.rows) {
      const name = row.CONSTRAINT_NAME as string;
      if (!fkMap.has(name)) {
        fkMap.set(name, {
          name,
          columns: [],
          referencedTable: row.REFERENCED_TABLE as string,
          referencedColumns: [],
          onDelete: row.DELETE_RULE as string
        });
      }
      const fk = fkMap.get(name)!;
      fk.columns.push(row.COLUMN_NAME as string);
      fk.referencedColumns.push(row.REFERENCED_COLUMN as string);
    }

    return Array.from(fkMap.values());
  }

  protected escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  protected override getPlaceholder(index: number): string {
    return `:p${index}`;
  }

  protected override getTestQuery(): string {
    return 'SELECT 1 FROM DUAL';
  }

  protected override buildSelectQuery(table: string, options?: { limit?: number; offset?: number; orderBy?: Array<{ column: string; direction: 'ASC' | 'DESC' }>; where?: Record<string, unknown> }): string {
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

    const limit = options?.limit || 100;
    const offset = options?.offset || 0;
    sql += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    return sql;
  }

  private mapOracleType(dbType: number | undefined): string {
    if (dbType === undefined) return 'unknown';

    const typeMap: Record<number, string> = {
      1: 'VARCHAR2',
      2: 'NUMBER',
      12: 'DATE',
      23: 'RAW',
      96: 'CHAR',
      100: 'BINARY_FLOAT',
      101: 'BINARY_DOUBLE',
      104: 'ROWID',
      112: 'CLOB',
      113: 'BLOB',
      114: 'BFILE',
      180: 'TIMESTAMP',
      181: 'TIMESTAMP WITH TIME ZONE',
      182: 'INTERVAL YEAR TO MONTH',
      183: 'INTERVAL DAY TO SECOND',
      231: 'TIMESTAMP WITH LOCAL TIME ZONE',
      187: 'TIMESTAMP WITH LOCAL TZ',
      2001: 'OBJECT',
      2002: 'NESTED TABLE',
      2003: 'VARRAY',
      2007: 'XMLTYPE',
      2023: 'NCHAR',
      2024: 'NVARCHAR2',
      2025: 'NCLOB'
    };

    return typeMap[dbType] || `TYPE_${dbType}`;
  }
}
