import neo4j, { type Driver, type Session, type Record as Neo4jRecord } from 'neo4j-driver';
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

export class Neo4jAdapter extends BaseAdapter implements IDatabaseAdapter {
  private driver: Driver | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.driver) {
      return;
    }

    const scheme = this._config.neo4jScheme || 'bolt';
    const host = this._config.host || 'localhost';
    const port = this._config.port || 7687;
    const url = `${scheme}://${host}:${port}`;

    try {
      this.driver = neo4j.driver(
        url,
        this._config.username && this._config.password
          ? neo4j.auth.basic(this._config.username, this._config.password)
          : undefined
      );

      await this.driver.verifyConnectivity();
      this._connected = true;
    } catch (error) {
      this._connected = false;
      this.driver = null;
      throw new Error(`Failed to connect to Neo4j: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
    this._connected = false;
  }

  private getSession(): Session {
    if (!this.driver) {
      throw new Error('Not connected to database');
    }
    return this.driver.session({
      database: this._config.database || undefined
    });
  }

  async executeQuery(cypher: string, params?: unknown[]): Promise<IQueryResult> {
    const startTime = Date.now();
    const session = this.getSession();

    try {
      // Convert array params to named params object for Neo4j driver
      let paramsObj: Record<string, unknown> | undefined;
      if (params && params.length > 0) {
        paramsObj = {};
        params.forEach((param, i) => {
          paramsObj![`p${i}`] = param;
        });
      }

      const result = await session.run(cypher, paramsObj);

      const rows: Record<string, unknown>[] = result.records.map((record: Neo4jRecord) => {
        const row: Record<string, unknown> = {};
        record.keys.forEach((key: string) => {
          const value = record.get(key);
          row[key] = this.convertNeo4jValue(value);
        });
        return row;
      });

      const columns: IColumn[] = result.records.length > 0
        ? result.records[0].keys.map((key: string) => ({
            name: key,
            type: this.inferNeo4jType(result.records[0].get(key)),
            nullable: true,
            primaryKey: false
          }))
        : [];

      return {
        columns,
        rows,
        rowCount: rows.length,
        affectedRows: result.summary.counters.updates().nodesCreated
          + result.summary.counters.updates().nodesDeleted
          + result.summary.counters.updates().propertiesSet || undefined,
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
    } finally {
      await session.close();
    }
  }

  async getTables(database?: string): Promise<ITable[]> {
    const session = this.getSession();

    try {
      const result = await session.run('CALL db.labels() YIELD label RETURN label');

      const tables: ITable[] = [];
      for (const record of result.records) {
        const label = record.get('label') as string;
        const columns = await this.getColumns(label);

        tables.push({
          name: label,
          columns,
          indexes: [],
          foreignKeys: []
        });
      }

      return tables;
    } finally {
      await session.close();
    }
  }

  async getColumns(table: string, _schema?: string): Promise<IColumn[]> {
    const session = this.getSession();

    try {
      const result = await session.run(
        `MATCH (n:\`${this.escapeLabel(table)}\`) RETURN n LIMIT 100`
      );

      const propertyMap = new Map<string, string>();

      for (const record of result.records) {
        const node = record.get('n');
        if (node && node.properties) {
          for (const [key, value] of Object.entries(node.properties)) {
            if (!propertyMap.has(key)) {
              propertyMap.set(key, this.inferNeo4jType(value));
            }
          }
        }
      }

      return Array.from(propertyMap.entries()).map(([name, type]) => ({
        name,
        type,
        nullable: true,
        primaryKey: false
      }));
    } finally {
      await session.close();
    }
  }

  async getIndexes(table?: string, _schema?: string): Promise<IIndex[]> {
    const session = this.getSession();

    try {
      const result = await session.run('SHOW INDEXES');

      return result.records.map((record: Neo4jRecord) => ({
        name: String(record.get('name') || 'unnamed'),
        columns: Array.isArray(record.get('properties'))
          ? (record.get('properties') as string[])
          : [],
        unique: String(record.get('uniqueness') || '').toUpperCase() === 'UNIQUE'
      }));
    } catch {
      // Fallback for older Neo4j versions that don't support SHOW INDEXES
      return [];
    } finally {
      await session.close();
    }
  }

  async getSchema(): Promise<ISchema> {
    const tables = await this.getTables();

    return {
      databases: [
        {
          name: this._config.database || 'neo4j',
          tables,
          views: []
        }
      ]
    };
  }

  async getDatabases(): Promise<string[]> {
    const session = this.getSession();

    try {
      const result = await session.run('SHOW DATABASES');
      return result.records.map(
        (record: Neo4jRecord) => String(record.get('name'))
      );
    } catch {
      // Fallback for Neo4j versions prior to 4.x
      return [this._config.database || 'neo4j'];
    } finally {
      await session.close();
    }
  }

  async getPrimaryKey(_table: string, _schema?: string): Promise<string[]> {
    // Graph databases do not have traditional primary keys
    return [];
  }

  async getVersion(): Promise<string> {
    const session = this.getSession();

    try {
      const result = await session.run(
        'CALL dbms.components() YIELD name, versions RETURN versions[0] AS version'
      );

      if (result.records.length > 0) {
        return String(result.records[0].get('version'));
      }

      return 'Unknown';
    } catch {
      return 'Unknown';
    } finally {
      await session.close();
    }
  }

  async insertRow(table: string, data: Record<string, unknown>): Promise<IQueryResult> {
    const startTime = Date.now();
    const session = this.getSession();

    try {
      const cypher = `CREATE (n:\`${this.escapeLabel(table)}\`) SET n = $props RETURN n`;
      const result = await session.run(cypher, { props: data });

      const rows: Record<string, unknown>[] = result.records.map((record: Neo4jRecord) => {
        const node = record.get('n');
        return node.properties ? { ...node.properties } : {};
      });

      return {
        columns: [],
        rows,
        rowCount: rows.length,
        affectedRows: result.summary.counters.updates().nodesCreated,
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
    } finally {
      await session.close();
    }
  }

  async deleteRow(table: string, where: Record<string, unknown>): Promise<IQueryResult> {
    const startTime = Date.now();
    const session = this.getSession();

    try {
      const whereClause = this.buildCypherWhereClause(where);
      const cypher = `MATCH (n:\`${this.escapeLabel(table)}\`) WHERE ${whereClause} DELETE n`;
      const result = await session.run(cypher, where);

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: result.summary.counters.updates().nodesDeleted,
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
    } finally {
      await session.close();
    }
  }

  async updateRow(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<IQueryResult> {
    const startTime = Date.now();
    const session = this.getSession();

    try {
      const whereClause = this.buildCypherWhereClause(where, 'where_');
      const setClauses = Object.keys(data)
        .map(key => `n.\`${this.escapeLabel(key)}\` = $set_${key}`)
        .join(', ');

      const cypher = `MATCH (n:\`${this.escapeLabel(table)}\`) WHERE ${whereClause} SET ${setClauses} RETURN n`;

      const params: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(where)) {
        params[`where_${key}`] = value;
      }
      for (const [key, value] of Object.entries(data)) {
        params[`set_${key}`] = value;
      }

      const result = await session.run(cypher, params);

      const rows: Record<string, unknown>[] = result.records.map((record: Neo4jRecord) => {
        const node = record.get('n');
        return node.properties ? { ...node.properties } : {};
      });

      return {
        columns: [],
        rows,
        rowCount: rows.length,
        affectedRows: result.summary.counters.updates().propertiesSet,
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
    } finally {
      await session.close();
    }
  }

  async explainQuery(cypher: string): Promise<IQueryPlan> {
    const result = await this.executeQuery(`EXPLAIN ${cypher}`);
    return {
      plan: result.rows,
      textRepresentation: result.rows.map(r => Object.values(r).join(' ')).join('\n')
    };
  }

  protected escapeIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  protected override getTestQuery(): string {
    return 'RETURN 1';
  }

  protected override getPlaceholder(index: number): string {
    return `$${index}`;
  }

  private escapeLabel(label: string): string {
    return label.replace(/`/g, '``');
  }

  private buildCypherWhereClause(
    where: Record<string, unknown>,
    prefix: string = ''
  ): string {
    return Object.keys(where)
      .map(key => `n.\`${this.escapeLabel(key)}\` = $${prefix}${key}`)
      .join(' AND ');
  }

  private convertNeo4jValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle Neo4j Integer type
    if (neo4j.isInt(value)) {
      return (value as { toNumber: () => number }).toNumber();
    }

    // Handle Neo4j Node type
    if (typeof value === 'object' && value !== null && 'properties' in value) {
      const node = value as { properties: Record<string, unknown>; labels?: string[] };
      return {
        ...Object.fromEntries(
          Object.entries(node.properties).map(([k, v]) => [k, this.convertNeo4jValue(v)])
        ),
        _labels: node.labels
      };
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map(v => this.convertNeo4jValue(v));
    }

    return value;
  }

  private inferNeo4jType(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (neo4j.isInt(value)) {
      return 'integer';
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'float';
    }
    if (typeof value === 'boolean') {
      return 'boolean';
    }
    if (typeof value === 'string') {
      return 'string';
    }
    if (Array.isArray(value)) {
      return 'list';
    }
    if (typeof value === 'object' && value !== null) {
      if ('properties' in value) {
        return 'node';
      }
      if ('start' in value && 'end' in value) {
        return 'relationship';
      }
      return 'map';
    }
    return 'unknown';
  }
}
