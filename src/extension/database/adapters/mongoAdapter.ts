import { MongoClient, type Db, type Document } from 'mongodb';
import { BaseAdapter } from './baseAdapter';
import type {
  ISchema,
  ITable,
  IColumn,
  IIndex,
  IQueryResult,
  IConnectionConfig
} from '../interfaces/IAdapter';

export class MongoAdapter extends BaseAdapter {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.client) {
      return;
    }

    let connectionString: string;

    if (this._config.connectionString) {
      connectionString = this._config.connectionString;
    } else {
      const auth = this._config.username && this._config.password
        ? `${encodeURIComponent(this._config.username)}:${encodeURIComponent(this._config.password)}@`
        : '';
      const host = this._config.host || 'localhost';
      const port = this._config.port || 27017;
      connectionString = `mongodb://${auth}${host}:${port}/${this._config.database}`;
    }

    try {
      this.client = new MongoClient(connectionString);
      await this.client.connect();
      this.db = this.client.db(this._config.database);
      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(`Failed to connect to MongoDB: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
    this._connected = false;
  }

  async executeQuery(query: string): Promise<IQueryResult> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const parsed = JSON.parse(query);
      const collection = parsed.collection;
      const operation = parsed.operation || 'find';
      const filter = parsed.filter || {};
      const options = parsed.options || {};

      let result: Document[] = [];
      let affectedRows: number | undefined;

      switch (operation) {
        case 'find':
          result = await this.db.collection(collection)
            .find(filter)
            .limit(options.limit || 100)
            .skip(options.skip || 0)
            .toArray();
          break;

        case 'aggregate':
          result = await this.db.collection(collection)
            .aggregate(parsed.pipeline || [])
            .toArray();
          break;

        case 'insertOne':
          const insertResult = await this.db.collection(collection).insertOne(parsed.document);
          affectedRows = insertResult.acknowledged ? 1 : 0;
          result = [{ insertedId: insertResult.insertedId }];
          break;

        case 'insertMany':
          const insertManyResult = await this.db.collection(collection).insertMany(parsed.documents);
          affectedRows = insertManyResult.insertedCount;
          result = [{ insertedIds: insertManyResult.insertedIds }];
          break;

        case 'updateOne':
          const updateResult = await this.db.collection(collection).updateOne(filter, parsed.update);
          affectedRows = updateResult.modifiedCount;
          result = [{ matchedCount: updateResult.matchedCount, modifiedCount: updateResult.modifiedCount }];
          break;

        case 'updateMany':
          const updateManyResult = await this.db.collection(collection).updateMany(filter, parsed.update);
          affectedRows = updateManyResult.modifiedCount;
          result = [{ matchedCount: updateManyResult.matchedCount, modifiedCount: updateManyResult.modifiedCount }];
          break;

        case 'deleteOne':
          const deleteResult = await this.db.collection(collection).deleteOne(filter);
          affectedRows = deleteResult.deletedCount;
          result = [{ deletedCount: deleteResult.deletedCount }];
          break;

        case 'deleteMany':
          const deleteManyResult = await this.db.collection(collection).deleteMany(filter);
          affectedRows = deleteManyResult.deletedCount;
          result = [{ deletedCount: deleteManyResult.deletedCount }];
          break;

        case 'count':
          const count = await this.db.collection(collection).countDocuments(filter);
          result = [{ count }];
          break;

        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      const columns = this.inferColumns(result);

      return {
        columns,
        rows: result as Record<string, unknown>[],
        rowCount: result.length,
        affectedRows,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          executionTime: Date.now() - startTime,
          error: 'Invalid JSON query. Expected format: {"collection": "name", "operation": "find", "filter": {}}'
        };
      }

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
          name: this._config.database,
          tables,
          views: []
        }
      ]
    };
  }

  async getTables(): Promise<ITable[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const collections = await this.db.listCollections().toArray();
    const tables: ITable[] = [];

    for (const collection of collections) {
      const columns = await this.getColumns(collection.name);
      const indexes = await this.getIndexes(collection.name);
      const rowCount = await this.getCollectionCount(collection.name);

      tables.push({
        name: collection.name,
        columns,
        indexes,
        foreignKeys: [],
        rowCount
      });
    }

    return tables;
  }

  async getColumns(table: string): Promise<IColumn[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const sample = await this.db.collection(table).findOne();
    if (!sample) {
      return [{ name: '_id', type: 'ObjectId', nullable: false, primaryKey: true }];
    }

    return this.extractColumnsFromDocument(sample);
  }

  async getIndexes(table: string): Promise<IIndex[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const indexes = await this.db.collection(table).indexes();

    return indexes
      .filter(idx => idx.name !== '_id_')
      .map(idx => ({
        name: idx.name || 'unnamed',
        columns: Object.keys(idx.key),
        unique: Boolean(idx.unique)
      }));
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    return ['_id'];
  }

  private async getCollectionCount(collection: string): Promise<number> {
    if (!this.db) return 0;
    return await this.db.collection(collection).estimatedDocumentCount();
  }

  async getVersion(): Promise<string> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const result = await this.db.admin().serverInfo();
    return result.version || 'Unknown';
  }

  async getTableData(table: string, options?: { limit?: number; offset?: number }): Promise<IQueryResult> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const cursor = this.db.collection(table)
        .find({})
        .skip(options?.offset || 0)
        .limit(options?.limit || 100);

      const rows = await cursor.toArray();
      const columns = this.inferColumns(rows);

      return {
        columns,
        rows: rows as Record<string, unknown>[],
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
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const result = await this.db.collection(table).insertOne(data);
      return {
        columns: [],
        rows: [{ insertedId: result.insertedId }],
        rowCount: 0,
        affectedRows: result.acknowledged ? 1 : 0,
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
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const result = await this.db.collection(table).updateOne(where, { $set: data });
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: result.modifiedCount,
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
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const result = await this.db.collection(table).deleteOne(where);
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: result.deletedCount,
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

  private inferColumns(documents: Document[]): IColumn[] {
    const columnMap = new Map<string, IColumn>();

    for (const doc of documents) {
      this.extractColumnsFromDocument(doc).forEach(col => {
        if (!columnMap.has(col.name)) {
          columnMap.set(col.name, col);
        }
      });
    }

    return Array.from(columnMap.values());
  }

  private extractColumnsFromDocument(doc: Document): IColumn[] {
    const columns: IColumn[] = [];

    for (const [key, value] of Object.entries(doc)) {
      columns.push({
        name: key,
        type: this.getMongoType(value),
        nullable: value === null,
        primaryKey: key === '_id'
      });
    }

    return columns;
  }

  private getMongoType(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    if (typeof value === 'object') {
      if ('_bsontype' in value) {
        return (value as { _bsontype: string })._bsontype;
      }
      return 'object';
    }
    return typeof value;
  }
}
