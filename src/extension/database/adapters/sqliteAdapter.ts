import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { BaseAdapter } from './baseAdapter';
import type {
  ISchema,
  ITable,
  IColumn,
  IIndex,
  IQueryResult,
  IConnectionConfig
} from '../interfaces/IAdapter';
import type { IQueryPlan, IView, ITrigger } from '../../../shared/types/database';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export class SQLiteAdapter extends BaseAdapter {
  private db: SqlJsDatabase | null = null;
  private filePath: string = '';

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.db) {
      return;
    }

    this.filePath = this._config.filename || this._config.database;
    if (!this.filePath) {
      throw new Error('SQLite requires a filename or database path');
    }

    try {
      if (!SQL) {
        // Locate the wasm file in the extension's dist folder
        const wasmPath = path.join(__dirname, 'sql-wasm.wasm');
        const wasmBinary = fs.readFileSync(wasmPath);
        SQL = await initSqlJs({ wasmBinary });
      }

      if (fs.existsSync(this.filePath)) {
        const fileBuffer = fs.readFileSync(this.filePath);
        this.db = new SQL.Database(fileBuffer);
      } else {
        this.db = new SQL.Database();
      }

      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(`Failed to connect to SQLite database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.saveToFile();
      this.db.close();
      this.db = null;
    }
    this._connected = false;
  }

  private saveToFile(): void {
    if (this.db && this.filePath) {
      try {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.filePath, buffer);
      } catch (error) {
        console.error('Failed to save database:', error);
      }
    }
  }

  async executeQuery(sql: string, params?: unknown[]): Promise<IQueryResult> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();
    const trimmedSql = sql.trim();
    const isSelect = /^SELECT/i.test(trimmedSql) ||
                     /^PRAGMA/i.test(trimmedSql) ||
                     /^WITH/i.test(trimmedSql) ||
                     /^EXPLAIN/i.test(trimmedSql);

    try {
      if (isSelect) {
        const stmt = this.db.prepare(sql);
        if (params && params.length > 0) {
          stmt.bind(params);
        }

        const columns: IColumn[] = stmt.getColumnNames().map(name => ({
          name,
          type: 'TEXT',
          nullable: true,
          primaryKey: false
        }));

        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) {
          const row = stmt.getAsObject();
          rows.push(row as Record<string, unknown>);
        }
        stmt.free();

        return {
          columns,
          rows,
          rowCount: rows.length,
          executionTime: Date.now() - startTime
        };
      } else {
        if (params && params.length > 0) {
          this.db.run(sql, params);
        } else {
          this.db.run(sql);
        }

        const changes = this.db.getRowsModified();
        this.saveToFile();

        return {
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: changes,
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
          name: this._config.database || 'main',
          tables,
          views
        }
      ]
    };
  }

  async getTables(): Promise<ITable[]> {
    const result = await this.executeQuery(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );

    const tables: ITable[] = [];
    for (const row of result.rows) {
      const tableName = row.name as string;
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
    const result = await this.executeQuery(
      "SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name"
    );

    return result.rows.map(row => ({
      name: row.name as string,
      definition: row.sql as string | undefined
    }));
  }

  async getViewDefinition(viewName: string): Promise<string> {
    const result = await this.executeQuery(
      "SELECT sql FROM sqlite_master WHERE type='view' AND name=?",
      [viewName]
    );
    return (result.rows[0]?.sql as string) || '';
  }

  async getTriggers(_table?: string): Promise<ITrigger[]> {
    let sql = "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'";
    const params: unknown[] = [];

    if (_table) {
      sql += ' AND tbl_name=?';
      params.push(_table);
    }

    sql += ' ORDER BY name';

    const result = await this.executeQuery(sql, params);

    return result.rows.map(row => {
      const triggerSql = (row.sql as string) || '';
      let event = 'UNKNOWN';
      let timing = 'UNKNOWN';

      if (/BEFORE/i.test(triggerSql)) timing = 'BEFORE';
      else if (/AFTER/i.test(triggerSql)) timing = 'AFTER';
      else if (/INSTEAD\s+OF/i.test(triggerSql)) timing = 'INSTEAD OF';

      if (/INSERT/i.test(triggerSql)) event = 'INSERT';
      else if (/UPDATE/i.test(triggerSql)) event = 'UPDATE';
      else if (/DELETE/i.test(triggerSql)) event = 'DELETE';

      return {
        name: row.name as string,
        table: row.tbl_name as string,
        event,
        timing,
        enabled: true
      };
    });
  }

  async getColumns(table: string): Promise<IColumn[]> {
    const result = await this.executeQuery(`PRAGMA table_info(${this.escapeIdentifier(table)})`);

    return result.rows.map(row => ({
      name: row.name as string,
      type: (row.type as string) || 'TEXT',
      nullable: (row.notnull as number) === 0,
      primaryKey: (row.pk as number) > 0,
      defaultValue: row.dflt_value,
      autoIncrement: this.isAutoIncrement(table, (row.pk as number) > 0)
    }));
  }

  private isAutoIncrement(table: string, isPrimaryKey: boolean): boolean {
    if (!isPrimaryKey || !this.db) return false;

    try {
      const stmt = this.db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
      );
      stmt.bind([table]);

      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        if (row.sql) {
          return /AUTOINCREMENT/i.test(row.sql as string);
        }
      }
      stmt.free();
    } catch {
      // Ignore errors
    }
    return false;
  }

  async getIndexes(table: string): Promise<IIndex[]> {
    const result = await this.executeQuery(`PRAGMA index_list(${this.escapeIdentifier(table)})`);

    const indexes: IIndex[] = [];
    for (const row of result.rows) {
      const indexName = row.name as string;
      const indexInfo = await this.executeQuery(`PRAGMA index_info(${this.escapeIdentifier(indexName)})`);

      indexes.push({
        name: indexName,
        columns: indexInfo.rows.map(r => r.name as string),
        unique: (row.unique as number) === 1
      });
    }

    return indexes;
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    const columns = await this.getColumns(table);
    return columns.filter(c => c.primaryKey).map(c => c.name);
  }

  private async getForeignKeys(table: string): Promise<Array<{
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete?: string;
    onUpdate?: string;
  }>> {
    const result = await this.executeQuery(`PRAGMA foreign_key_list(${this.escapeIdentifier(table)})`);

    const fkMap = new Map<number, {
      name: string;
      columns: string[];
      referencedTable: string;
      referencedColumns: string[];
      onDelete?: string;
      onUpdate?: string;
    }>();

    for (const row of result.rows) {
      const id = row.id as number;
      if (!fkMap.has(id)) {
        fkMap.set(id, {
          name: `fk_${table}_${id}`,
          columns: [],
          referencedTable: row.table as string,
          referencedColumns: [],
          onDelete: row.on_delete as string,
          onUpdate: row.on_update as string
        });
      }

      const fk = fkMap.get(id)!;
      fk.columns.push(row.from as string);
      fk.referencedColumns.push(row.to as string);
    }

    return Array.from(fkMap.values());
  }

  private async getTableRowCount(table: string): Promise<number> {
    const result = await this.executeQuery(
      `SELECT COUNT(*) as count FROM ${this.escapeIdentifier(table)}`
    );
    return (result.rows[0]?.count as number) || 0;
  }

  async getVersion(): Promise<string> {
    const result = await this.executeQuery('SELECT sqlite_version() as version');
    return (result.rows[0]?.version as string) || 'Unknown';
  }

  async explainQuery(sql: string): Promise<IQueryPlan> {
    const result = await this.executeQuery(`EXPLAIN QUERY PLAN ${sql}`);

    // Build tree from SQLite EXPLAIN QUERY PLAN output
    // Rows have: id, parent, notused, detail
    const textLines = result.rows.map(r => String(r.detail || Object.values(r).pop() || ''));
    const textRepresentation = textLines.join('\n');

    // Convert to structured plan nodes
    const planNodes = result.rows.map(r => {
      const detail = String(r.detail || '');
      let nodeType = 'Unknown';
      let tableName: string | undefined;

      if (detail.startsWith('SCAN')) {
        nodeType = 'Seq Scan';
        const match = detail.match(/SCAN\s+(\S+)/);
        if (match) tableName = match[1];
      } else if (detail.startsWith('SEARCH')) {
        nodeType = 'Index Scan';
        const match = detail.match(/SEARCH\s+(\S+)/);
        if (match) tableName = match[1];
      } else if (detail.includes('USING COVERING INDEX')) {
        nodeType = 'Index Only Scan';
      } else if (detail.includes('COMPOUND SUBQUERIES')) {
        nodeType = 'Compound Query';
      } else if (detail.includes('ORDER BY')) {
        nodeType = 'Sort';
      } else if (detail.includes('GROUP BY')) {
        nodeType = 'Aggregate';
      } else if (detail.includes('TEMP B-TREE')) {
        nodeType = 'Temp B-Tree';
      } else {
        nodeType = detail.split(' ')[0] || 'Operation';
      }

      return {
        'Node Type': nodeType,
        ...(tableName ? { 'Relation Name': tableName } : {}),
        detail,
      };
    });

    return {
      plan: planNodes,
      textRepresentation,
    };
  }

  protected escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  protected override getPlaceholder(_index: number): string {
    return '?';
  }

  protected override buildPlaceholders(count: number): string {
    return Array(count).fill('?').join(', ');
  }
}
