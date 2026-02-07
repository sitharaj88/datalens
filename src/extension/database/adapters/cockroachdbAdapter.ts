import { Pool, type PoolConfig, type QueryResult as PgQueryResult } from 'pg';
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

export class CockroachDBAdapter extends BaseAdapter implements IDatabaseAdapter {
  private pool: Pool | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.pool) {
      return;
    }

    const poolConfig: PoolConfig = {
      host: this._config.host || 'localhost',
      port: this._config.port || 26257,
      database: this._config.database,
      user: this._config.username,
      password: this._config.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    };

    if (this._config.connectionString) {
      poolConfig.connectionString = this._config.connectionString;
    }

    if (this._config.ssl) {
      poolConfig.ssl = typeof this._config.ssl === 'boolean'
        ? { rejectUnauthorized: false }
        : this._config.ssl as Record<string, unknown>;
    }

    try {
      this.pool = new Pool(poolConfig);
      const client = await this.pool.connect();
      client.release();
      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(`Failed to connect to CockroachDB: ${error instanceof Error ? error.message : String(error)}`);
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
      const result: PgQueryResult = await this.pool.query(sql, params);

      const columns: IColumn[] = result.fields?.map(field => ({
        name: field.name,
        type: this.getTypeNameFromOid(field.dataTypeID),
        nullable: true,
        primaryKey: false
      })) || [];

      return {
        columns,
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rows.length,
        affectedRows: result.rowCount ?? undefined,
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

  async getTables(database?: string): Promise<ITable[]> {
    const schema = 'public';

    const result = await this.executeQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `, [schema]);

    const tables: ITable[] = [];
    for (const row of result.rows) {
      const tableName = row.table_name as string;
      const columns = await this.getColumns(tableName, schema);
      const indexes = await this.getIndexes(tableName, schema);
      const foreignKeys = await this.getForeignKeys(tableName, schema);
      const rowCount = await this.getTableRowCount(tableName);

      tables.push({
        name: tableName,
        schema,
        columns,
        indexes,
        foreignKeys,
        rowCount
      });
    }

    return tables;
  }

  async getColumns(table: string, schema: string = 'public'): Promise<IColumn[]> {
    const result = await this.executeQuery(`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
        WHERE tc.table_name = $1 AND tc.table_schema = $2 AND tc.constraint_type = 'PRIMARY KEY'
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_name = $1 AND c.table_schema = $2
      ORDER BY c.ordinal_position
    `, [table, schema]);

    return result.rows.map(row => ({
      name: row.column_name as string,
      type: row.data_type as string,
      nullable: (row.is_nullable as string) === 'YES',
      primaryKey: row.is_primary_key as boolean,
      defaultValue: row.column_default,
      autoIncrement: String(row.column_default || '').includes('unique_rowid') ||
                     String(row.column_default || '').includes('nextval')
    }));
  }

  async getIndexes(table: string, schema: string = 'public'): Promise<IIndex[]> {
    const result = await this.executeQuery(`
      SELECT
        i.relname as index_name,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
        ix.indisunique as is_unique
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.relname = $1 AND n.nspname = $2 AND NOT ix.indisprimary
      GROUP BY i.relname, ix.indisunique
      ORDER BY i.relname
    `, [table, schema]);

    return result.rows.map(row => ({
      name: row.index_name as string,
      columns: row.columns as string[],
      unique: row.is_unique as boolean
    }));
  }

  async getPrimaryKey(table: string, schema: string = 'public'): Promise<string[]> {
    const result = await this.executeQuery(`
      SELECT ku.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
      WHERE tc.table_name = $1 AND tc.table_schema = $2 AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY ku.ordinal_position
    `, [table, schema]);

    return result.rows.map(row => row.column_name as string);
  }

  async getVersion(): Promise<string> {
    const result = await this.executeQuery('SELECT version()');
    const version = (result.rows[0]?.version as string) || 'Unknown';
    // CockroachDB version() returns something like "CockroachDB CCL v22.1.0 ..."
    return version.startsWith('CockroachDB') ? version : `CockroachDB ${version}`;
  }

  async getDatabases(): Promise<string[]> {
    const result = await this.executeQuery('SHOW DATABASES');
    return result.rows.map(row => {
      const dbName = row.database_name || row.Database || Object.values(row)[0];
      return dbName as string;
    });
  }

  async getSchemas(database?: string): Promise<string[]> {
    const result = await this.executeQuery(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE catalog_name = $1
      ORDER BY schema_name
    `, [database || this._config.database]);

    return result.rows.map(row => row.schema_name as string);
  }

  async getStoredProcedures(database?: string): Promise<IStoredProcedure[]> {
    const result = await this.executeQuery(`
      SELECT
        routine_name,
        routine_schema,
        routine_type,
        routine_definition,
        external_language
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      ORDER BY routine_name
    `);

    return result.rows.map(row => ({
      name: row.routine_name as string,
      schema: row.routine_schema as string,
      definition: row.routine_definition as string | undefined,
      returnType: row.routine_type as string | undefined,
      language: row.external_language as string | undefined
    }));
  }

  async getTriggers(table?: string, schema: string = 'public'): Promise<ITrigger[]> {
    let sql = `
      SELECT
        trigger_name,
        event_object_table,
        event_manipulation,
        action_timing,
        action_statement
      FROM information_schema.triggers
      WHERE trigger_schema = $1
    `;
    const params: unknown[] = [schema];

    if (table) {
      sql += ' AND event_object_table = $2';
      params.push(table);
    }

    sql += ' ORDER BY trigger_name';

    const result = await this.executeQuery(sql, params);

    return result.rows.map(row => ({
      name: row.trigger_name as string,
      table: row.event_object_table as string,
      event: row.event_manipulation as string,
      timing: row.action_timing as string,
      definition: row.action_statement as string | undefined,
      enabled: true
    }));
  }

  async getViews(database?: string): Promise<IView[]> {
    const result = await this.executeQuery(`
      SELECT table_name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    return result.rows.map(row => ({
      name: row.table_name as string,
      schema: 'public',
      definition: row.view_definition as string | undefined
    }));
  }

  async getViewDefinition(viewName: string, schema: string = 'public'): Promise<string> {
    const result = await this.executeQuery(`
      SELECT view_definition
      FROM information_schema.views
      WHERE table_name = $1 AND table_schema = $2
    `, [viewName, schema]);

    return (result.rows[0]?.view_definition as string) || '';
  }

  async getUsers(): Promise<IUser[]> {
    const result = await this.executeQuery('SHOW USERS');

    return result.rows.map(row => ({
      name: (row.username || row.user_name || Object.values(row)[0]) as string,
      canLogin: true
    }));
  }

  async getRoles(): Promise<IRole[]> {
    const result = await this.executeQuery('SHOW ROLES');

    return result.rows.map(row => ({
      name: (row.role_name || row.username || Object.values(row)[0]) as string,
      privileges: []
    }));
  }

  async explainQuery(sql: string): Promise<IQueryPlan> {
    const result = await this.executeQuery(`EXPLAIN (FORMAT JSON) ${sql}`);

    let plan: unknown = result.rows;
    let textRepresentation = '';

    try {
      if (result.rows.length > 0) {
        const firstRow = result.rows[0];
        const jsonStr = firstRow.info || firstRow['QUERY PLAN'] || Object.values(firstRow)[0];
        if (typeof jsonStr === 'string') {
          plan = JSON.parse(jsonStr);
          textRepresentation = JSON.stringify(plan, null, 2);
        } else if (Array.isArray(jsonStr)) {
          plan = jsonStr;
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

  private async getForeignKeys(table: string, schema: string = 'public'): Promise<Array<{
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete?: string;
    onUpdate?: string;
  }>> {
    const result = await this.executeQuery(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule,
        rc.update_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1
        AND tc.table_schema = $2
    `, [table, schema]);

    const fkMap = new Map<string, {
      name: string;
      columns: string[];
      referencedTable: string;
      referencedColumns: string[];
      onDelete?: string;
      onUpdate?: string;
    }>();

    for (const row of result.rows) {
      const name = row.constraint_name as string;
      if (!fkMap.has(name)) {
        fkMap.set(name, {
          name,
          columns: [],
          referencedTable: row.foreign_table_name as string,
          referencedColumns: [],
          onDelete: row.delete_rule as string,
          onUpdate: row.update_rule as string
        });
      }
      const fk = fkMap.get(name)!;
      fk.columns.push(row.column_name as string);
      fk.referencedColumns.push(row.foreign_column_name as string);
    }

    return Array.from(fkMap.values());
  }

  private async getTableRowCount(table: string): Promise<number> {
    const result = await this.executeQuery(
      `SELECT COUNT(*)::int as count FROM ${this.escapeIdentifier(table)}`
    );
    return (result.rows[0]?.count as number) || 0;
  }

  protected escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  protected override getPlaceholder(index: number): string {
    return `$${index}`;
  }

  private getTypeNameFromOid(oid: number): string {
    const typeMap: Record<number, string> = {
      16: 'boolean',
      20: 'bigint',
      21: 'smallint',
      23: 'integer',
      25: 'text',
      700: 'real',
      701: 'double precision',
      1042: 'char',
      1043: 'varchar',
      1082: 'date',
      1083: 'time',
      1114: 'timestamp',
      1184: 'timestamptz',
      2950: 'uuid',
      3802: 'jsonb',
      114: 'json'
    };
    return typeMap[oid] || 'unknown';
  }
}
