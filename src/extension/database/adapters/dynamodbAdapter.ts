import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
  UpdateItemCommand,
  ExecuteStatementCommand
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand as DocScanCommand,
  PutCommand,
  DeleteCommand,
  GetCommand
} from '@aws-sdk/lib-dynamodb';
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

export class DynamoDBAdapter extends BaseAdapter {
  private client: DynamoDBClient | null = null;
  private docClient: DynamoDBDocumentClient | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.client) {
      return;
    }

    try {
      const clientConfig: Record<string, unknown> = {
        region: this._config.awsRegion || 'us-east-1',
        credentials: {
          accessKeyId: this._config.awsAccessKeyId || '',
          secretAccessKey: this._config.awsSecretAccessKey || ''
        }
      };

      if (this._config.host) {
        clientConfig.endpoint = `http://${this._config.host}:${this._config.port || 8000}`;
      }

      this.client = new DynamoDBClient(clientConfig);
      this.docClient = DynamoDBDocumentClient.from(this.client);
      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(`Failed to connect to DynamoDB: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.docClient = null;
    }
    this._connected = false;
  }

  async executeQuery(statement: string, params?: unknown[]): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const command = new ExecuteStatementCommand({
        Statement: statement,
        Parameters: params?.map(p => this.toDynamoDBValue(p))
      });

      const response = await this.client.send(command);
      const rows = (response.Items || []).map(item => this.unmarshallItem(item));
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

  async getTables(): Promise<ITable[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const command = new ListTablesCommand({});
    const response = await this.client.send(command);
    const tableNames = response.TableNames || [];

    const tables: ITable[] = [];

    for (const tableName of tableNames) {
      const columns = await this.getColumns(tableName);
      const indexes = await this.getIndexes(tableName);

      tables.push({
        name: tableName,
        columns,
        indexes,
        foreignKeys: []
      });
    }

    return tables;
  }

  async getColumns(table: string): Promise<IColumn[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const command = new DescribeTableCommand({ TableName: table });
    const response = await this.client.send(command);
    const tableDescription = response.Table;

    if (!tableDescription) {
      return [];
    }

    const keySchemaMap = new Map<string, string>();
    for (const key of tableDescription.KeySchema || []) {
      if (key.AttributeName && key.KeyType) {
        keySchemaMap.set(key.AttributeName, key.KeyType);
      }
    }

    const columns: IColumn[] = (tableDescription.AttributeDefinitions || []).map(attr => ({
      name: attr.AttributeName || '',
      type: this.mapDynamoDBType(attr.AttributeType || 'S'),
      nullable: !keySchemaMap.has(attr.AttributeName || ''),
      primaryKey: keySchemaMap.get(attr.AttributeName || '') === 'HASH'
    }));

    return columns;
  }

  async getIndexes(table: string): Promise<IIndex[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const command = new DescribeTableCommand({ TableName: table });
    const response = await this.client.send(command);
    const tableDescription = response.Table;

    if (!tableDescription) {
      return [];
    }

    const indexes: IIndex[] = [];

    for (const gsi of tableDescription.GlobalSecondaryIndexes || []) {
      indexes.push({
        name: gsi.IndexName || 'unnamed',
        columns: (gsi.KeySchema || []).map(k => k.AttributeName || ''),
        unique: false
      });
    }

    for (const lsi of tableDescription.LocalSecondaryIndexes || []) {
      indexes.push({
        name: lsi.IndexName || 'unnamed',
        columns: (lsi.KeySchema || []).map(k => k.AttributeName || ''),
        unique: false
      });
    }

    return indexes;
  }

  async getSchema(): Promise<ISchema> {
    const tables = await this.getTables();

    return {
      databases: [
        {
          name: this._config.awsRegion || 'default',
          tables,
          views: []
        }
      ]
    };
  }

  async getDatabases(): Promise<string[]> {
    return [this._config.awsRegion || 'default'];
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const command = new DescribeTableCommand({ TableName: table });
    const response = await this.client.send(command);
    const keySchema = response.Table?.KeySchema || [];

    return keySchema.map(k => k.AttributeName || '');
  }

  async getVersion(): Promise<string> {
    return 'DynamoDB';
  }

  async getTableData(table: string, options?: { limit?: number; offset?: number }): Promise<IQueryResult> {
    if (!this.docClient) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const command = new DocScanCommand({
        TableName: table,
        Limit: options?.limit || 100
      });

      const response = await this.docClient.send(command);
      const rows = (response.Items || []) as Record<string, unknown>[];
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
    if (!this.docClient) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const command = new PutCommand({
        TableName: table,
        Item: data
      });

      await this.docClient.send(command);

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

  async deleteRow(table: string, where: Record<string, unknown>): Promise<IQueryResult> {
    if (!this.docClient) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const command = new DeleteCommand({
        TableName: table,
        Key: where
      });

      await this.docClient.send(command);

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
    where: Record<string, unknown>
  ): Promise<IQueryResult> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const expressionParts: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};
      let index = 0;

      for (const [key, value] of Object.entries(data)) {
        const nameAlias = `#attr${index}`;
        const valueAlias = `:val${index}`;
        expressionParts.push(`${nameAlias} = ${valueAlias}`);
        expressionAttributeNames[nameAlias] = key;
        expressionAttributeValues[valueAlias] = this.toDynamoDBValue(value);
        index++;
      }

      const keyObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(where)) {
        keyObj[key] = this.toDynamoDBValue(value);
      }

      const command = new UpdateItemCommand({
        TableName: table,
        Key: keyObj,
        UpdateExpression: `SET ${expressionParts.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
      });

      await this.client.send(command);

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

  async testConnection(): Promise<boolean> {
    try {
      const wasConnected = this._connected;
      if (!wasConnected) {
        await this.connect();
      }

      if (!this.client) {
        return false;
      }

      await this.client.send(new ListTablesCommand({}));

      if (!wasConnected) {
        await this.disconnect();
      }

      return true;
    } catch {
      return false;
    }
  }

  protected escapeIdentifier(identifier: string): string {
    return identifier;
  }

  protected override getPlaceholder(_index: number): string {
    return '?';
  }

  protected override getTestQuery(): string {
    return 'SELECT 1';
  }

  private mapDynamoDBType(attributeType: string): string {
    const typeMap: Record<string, string> = {
      'S': 'String',
      'N': 'Number',
      'B': 'Binary',
      'SS': 'StringSet',
      'NS': 'NumberSet',
      'BS': 'BinarySet',
      'M': 'Map',
      'L': 'List',
      'NULL': 'Null',
      'BOOL': 'Boolean'
    };
    return typeMap[attributeType] || attributeType;
  }

  private toDynamoDBValue(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined) {
      return { NULL: true };
    }
    if (typeof value === 'string') {
      return { S: value };
    }
    if (typeof value === 'number') {
      return { N: String(value) };
    }
    if (typeof value === 'boolean') {
      return { BOOL: value };
    }
    if (Array.isArray(value)) {
      return { L: value.map(v => this.toDynamoDBValue(v)) };
    }
    if (typeof value === 'object') {
      const map: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        map[k] = this.toDynamoDBValue(v);
      }
      return { M: map };
    }
    return { S: String(value) };
  }

  private unmarshallItem(item: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      result[key] = this.unmarshallValue(value as Record<string, unknown>);
    }
    return result;
  }

  private unmarshallValue(value: Record<string, unknown>): unknown {
    if ('S' in value) return value.S;
    if ('N' in value) return Number(value.N);
    if ('BOOL' in value) return value.BOOL;
    if ('NULL' in value) return null;
    if ('L' in value) {
      return (value.L as Record<string, unknown>[]).map(v => this.unmarshallValue(v));
    }
    if ('M' in value) {
      return this.unmarshallItem(value.M as Record<string, unknown>);
    }
    if ('SS' in value) return value.SS;
    if ('NS' in value) return (value.NS as string[]).map(Number);
    if ('BS' in value) return value.BS;
    return value;
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
            primaryKey: false
          });
        }
      }
    }

    return Array.from(columnMap.values());
  }

  private inferType(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return 'String';
    if (typeof value === 'number') return 'Number';
    if (typeof value === 'boolean') return 'Boolean';
    if (Array.isArray(value)) return 'List';
    if (typeof value === 'object') return 'Map';
    return typeof value;
  }
}
