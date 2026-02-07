import { Connection, Request, TYPES, type ColumnMetaData } from 'tedious';
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

export class MSSQLAdapter extends BaseAdapter {
  private connection: Connection | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.connection) {
      return;
    }

    return new Promise((resolve, reject) => {
      const config = {
        server: this._config.host || 'localhost',
        authentication: {
          type: 'default' as const,
          options: {
            userName: this._config.username || '',
            password: this._config.password || ''
          }
        },
        options: {
          database: this._config.database,
          port: this._config.port || 1433,
          encrypt: Boolean(this._config.ssl),
          trustServerCertificate: true,
          rowCollectionOnDone: true,
          rowCollectionOnRequestCompletion: true
        }
      };

      this.connection = new Connection(config);

      this.connection.on('connect', (err) => {
        if (err) {
          this._connected = false;
          reject(new Error(`Failed to connect to SQL Server: ${err.message}`));
        } else {
          this._connected = true;
          resolve();
        }
      });

      this.connection.connect();
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.connection) {
        this.connection.on('end', () => {
          this.connection = null;
          this._connected = false;
          resolve();
        });
        this.connection.close();
      } else {
        this._connected = false;
        resolve();
      }
    });
  }

  async executeQuery(sql: string, params?: unknown[]): Promise<IQueryResult> {
    if (!this.connection) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      const rows: Record<string, unknown>[] = [];
      let columns: IColumn[] = [];
      let affectedRows: number | undefined;

      const request = new Request(sql, (err, rowCount) => {
        if (err) {
          resolve({
            columns: [],
            rows: [],
            rowCount: 0,
            executionTime: Date.now() - startTime,
            error: err.message
          });
        } else {
          resolve({
            columns,
            rows,
            rowCount: rows.length,
            affectedRows: affectedRows ?? rowCount,
            executionTime: Date.now() - startTime
          });
        }
      });

      request.on('columnMetadata', (columnsMetadata: ColumnMetaData[]) => {
        columns = columnsMetadata.map(col => ({
          name: col.colName,
          type: col.type.name,
          nullable: Boolean(col.nullable),
          primaryKey: false
        }));
      });

      request.on('row', (rowColumns) => {
        const row: Record<string, unknown> = {};
        for (const column of rowColumns) {
          row[column.metadata.colName] = column.value;
        }
        rows.push(row);
      });

      request.on('doneInProc', (rowCount) => {
        if (rowCount !== undefined) {
          affectedRows = rowCount;
        }
      });

      if (params && params.length > 0) {
        params.forEach((param, index) => {
          const type = this.getTediousType(param);
          request.addParameter(`p${index + 1}`, type, param);
        });
      }

      this.connection!.execSql(request);
    });
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
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_CATALOG = DB_NAME()
      ORDER BY TABLE_NAME
    `);

    const tables: ITable[] = [];
    for (const row of result.rows) {
      const tableName = row.TABLE_NAME as string;
      const columns = await this.getColumns(tableName);
      const indexes = await this.getIndexes(tableName);
      const foreignKeys = await this.getForeignKeys(tableName);
      const rowCount = await this.getTableRowCount(tableName);

      tables.push({
        name: tableName,
        schema: 'dbo',
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
      FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_CATALOG = DB_NAME()
      ORDER BY TABLE_NAME
    `);

    return result.rows.map(row => ({
      name: row.TABLE_NAME as string,
      schema: 'dbo',
      definition: row.VIEW_DEFINITION as string | undefined
    }));
  }

  async getViewDefinition(viewName: string, _schema?: string): Promise<string> {
    const result = await this.executeQuery(`
      SELECT VIEW_DEFINITION
      FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_NAME = @p1 AND TABLE_CATALOG = DB_NAME()
    `, [viewName]);

    return (result.rows[0]?.VIEW_DEFINITION as string) || '';
  }

  async getColumns(table: string, schema: string = 'dbo'): Promise<IColumn[]> {
    const result = await this.executeQuery(`
      SELECT
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        c.COLUMN_DEFAULT,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as IS_PRIMARY_KEY,
        COLUMNPROPERTY(OBJECT_ID(@p2 + '.' + @p1), c.COLUMN_NAME, 'IsIdentity') as IS_IDENTITY
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        WHERE tc.TABLE_NAME = @p1 AND tc.TABLE_SCHEMA = @p2 AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE c.TABLE_NAME = @p1 AND c.TABLE_SCHEMA = @p2
      ORDER BY c.ORDINAL_POSITION
    `, [table, schema]);

    return result.rows.map(row => ({
      name: row.COLUMN_NAME as string,
      type: row.DATA_TYPE as string,
      nullable: (row.IS_NULLABLE as string) === 'YES',
      primaryKey: Boolean(row.IS_PRIMARY_KEY),
      defaultValue: row.COLUMN_DEFAULT,
      autoIncrement: Boolean(row.IS_IDENTITY)
    }));
  }

  async getIndexes(table: string, schema: string = 'dbo'): Promise<IIndex[]> {
    const result = await this.executeQuery(`
      SELECT
        i.name as INDEX_NAME,
        STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) as COLUMNS,
        i.is_unique as IS_UNIQUE
      FROM sys.indexes i
      JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      JOIN sys.tables t ON i.object_id = t.object_id
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE t.name = @p1 AND s.name = @p2 AND i.is_primary_key = 0 AND i.type > 0
      GROUP BY i.name, i.is_unique
      ORDER BY i.name
    `, [table, schema]);

    return result.rows.map(row => ({
      name: row.INDEX_NAME as string,
      columns: (row.COLUMNS as string).split(','),
      unique: Boolean(row.IS_UNIQUE)
    }));
  }

  async getPrimaryKey(table: string, schema: string = 'dbo'): Promise<string[]> {
    const result = await this.executeQuery(`
      SELECT ku.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
        ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
      WHERE tc.TABLE_NAME = @p1 AND tc.TABLE_SCHEMA = @p2 AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY ku.ORDINAL_POSITION
    `, [table, schema]);

    return result.rows.map(row => row.COLUMN_NAME as string);
  }

  private async getForeignKeys(table: string, schema: string = 'dbo'): Promise<Array<{
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete?: string;
    onUpdate?: string;
  }>> {
    const result = await this.executeQuery(`
      SELECT
        fk.name as CONSTRAINT_NAME,
        c.name as COLUMN_NAME,
        rt.name as REFERENCED_TABLE_NAME,
        rc.name as REFERENCED_COLUMN_NAME,
        fk.delete_referential_action_desc as DELETE_RULE,
        fk.update_referential_action_desc as UPDATE_RULE
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
      JOIN sys.tables t ON fk.parent_object_id = t.object_id
      JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
      JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE t.name = @p1 AND s.name = @p2
      ORDER BY fk.name, fkc.constraint_column_id
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
      const name = row.CONSTRAINT_NAME as string;
      if (!fkMap.has(name)) {
        fkMap.set(name, {
          name,
          columns: [],
          referencedTable: row.REFERENCED_TABLE_NAME as string,
          referencedColumns: [],
          onDelete: row.DELETE_RULE as string,
          onUpdate: row.UPDATE_RULE as string
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
    const result = await this.executeQuery('SELECT @@VERSION as version');
    return (result.rows[0]?.version as string) || 'Unknown';
  }

  async explainQuery(sql: string): Promise<IQueryPlan> {
    // MSSQL uses SET SHOWPLAN_XML for execution plans
    await this.executeQuery('SET SHOWPLAN_XML ON');
    const result = await this.executeQuery(sql);
    await this.executeQuery('SET SHOWPLAN_XML OFF');

    const planXml = result.rows[0] ? Object.values(result.rows[0])[0] as string : '';

    return {
      plan: result.rows,
      textRepresentation: planXml
    };
  }

  async getDatabases(): Promise<string[]> {
    const result = await this.executeQuery(
      "SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name"
    );
    return result.rows.map(row => row.name as string);
  }

  async getSchemas(_database?: string): Promise<string[]> {
    const result = await this.executeQuery(
      "SELECT schema_name FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY schema_name"
    );
    return result.rows.map(row => row.schema_name as string);
  }

  async getStoredProcedures(): Promise<IStoredProcedure[]> {
    const result = await this.executeQuery(`
      SELECT ROUTINE_NAME, ROUTINE_SCHEMA, ROUTINE_TYPE, DATA_TYPE
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_CATALOG = DB_NAME()
      ORDER BY ROUTINE_NAME
    `);

    return result.rows.map(row => ({
      name: row.ROUTINE_NAME as string,
      schema: row.ROUTINE_SCHEMA as string,
      returnType: row.ROUTINE_TYPE === 'FUNCTION' ? (row.DATA_TYPE as string) : undefined
    }));
  }

  async getTriggers(_table?: string): Promise<ITrigger[]> {
    let sql = `
      SELECT
        tr.name as trigger_name,
        OBJECT_NAME(tr.parent_id) as table_name,
        te.type_desc as event,
        CASE WHEN tr.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END as timing,
        CASE WHEN tr.is_disabled = 0 THEN 1 ELSE 0 END as is_enabled
      FROM sys.triggers tr
      JOIN sys.trigger_events te ON tr.object_id = te.object_id
      WHERE tr.parent_class_desc = 'OBJECT_OR_COLUMN'
    `;

    if (_table) {
      sql += ` AND OBJECT_NAME(tr.parent_id) = @p1`;
    }

    sql += ' ORDER BY tr.name';

    const result = await this.executeQuery(sql, _table ? [_table] : undefined);

    return result.rows.map(row => ({
      name: row.trigger_name as string,
      table: row.table_name as string,
      event: row.event as string,
      timing: row.timing as string,
      enabled: Boolean(row.is_enabled)
    }));
  }

  async getUsers(): Promise<IUser[]> {
    const result = await this.executeQuery(`
      SELECT name, type_desc
      FROM sys.database_principals
      WHERE type IN ('S', 'U', 'G') AND name NOT LIKE '##%' AND name != 'guest'
      ORDER BY name
    `);

    return result.rows.map(row => ({
      name: row.name as string,
      canLogin: true
    }));
  }

  async getRoles(): Promise<IRole[]> {
    const result = await this.executeQuery(`
      SELECT name
      FROM sys.database_principals
      WHERE type = 'R' AND is_fixed_role = 0
      ORDER BY name
    `);

    return result.rows.map(row => ({
      name: row.name as string,
      privileges: []
    }));
  }

  protected escapeIdentifier(identifier: string): string {
    return `[${identifier.replace(/\]/g, ']]')}]`;
  }

  protected override getPlaceholder(index: number): string {
    return `@p${index}`;
  }

  private getTediousType(value: unknown): typeof TYPES[keyof typeof TYPES] {
    if (value === null || value === undefined) return TYPES.NVarChar;
    if (typeof value === 'number') {
      return Number.isInteger(value) ? TYPES.Int : TYPES.Float;
    }
    if (typeof value === 'boolean') return TYPES.Bit;
    if (value instanceof Date) return TYPES.DateTime;
    return TYPES.NVarChar;
  }
}
