import * as admin from 'firebase-admin';
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

export class FirestoreAdapter extends BaseAdapter {
  private app: admin.app.App | null = null;
  private firestore: admin.firestore.Firestore | null = null;

  constructor(config: IConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected && this.firestore) {
      return;
    }

    try {
      const appName = `firestore-${this._config.id || Date.now()}`;

      const appOptions: admin.AppOptions = {};

      if (this._config.serviceAccountKey) {
        try {
          const serviceAccount = JSON.parse(this._config.serviceAccountKey);
          appOptions.credential = admin.credential.cert(serviceAccount);
        } catch {
          appOptions.credential = admin.credential.cert(this._config.serviceAccountKey);
        }
      } else {
        appOptions.credential = admin.credential.applicationDefault();
      }

      if (this._config.projectId) {
        appOptions.projectId = this._config.projectId;
      }

      this.app = admin.initializeApp(appOptions, appName);
      this.firestore = this.app.firestore();
      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(`Failed to connect to Firestore: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.delete();
      this.app = null;
      this.firestore = null;
    }
    this._connected = false;
  }

  async executeQuery(query: string): Promise<IQueryResult> {
    if (!this.firestore) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      // Parse a simple query language: collection.where(field, op, value).limit(n)
      // Or just a collection name to fetch all documents
      const parsed = this.parseQuery(query);

      let ref: admin.firestore.Query = this.firestore.collection(parsed.collection);

      for (const condition of parsed.conditions) {
        ref = ref.where(
          condition.field,
          condition.operator as admin.firestore.WhereFilterOp,
          condition.value
        );
      }

      if (parsed.limit) {
        ref = ref.limit(parsed.limit);
      }

      if (parsed.offset) {
        ref = ref.offset(parsed.offset);
      }

      const snapshot = await ref.get();
      const rows: Record<string, unknown>[] = [];

      snapshot.forEach(doc => {
        rows.push({
          _id: doc.id,
          ...doc.data()
        });
      });

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
    if (!this.firestore) {
      throw new Error('Not connected to database');
    }

    const collections = await this.firestore.listCollections();
    const tables: ITable[] = [];

    for (const collection of collections) {
      const columns = await this.getColumns(collection.id);

      tables.push({
        name: collection.id,
        columns,
        indexes: [],
        foreignKeys: []
      });
    }

    return tables;
  }

  async getColumns(table: string): Promise<IColumn[]> {
    if (!this.firestore) {
      throw new Error('Not connected to database');
    }

    try {
      const snapshot = await this.firestore.collection(table).limit(100).get();

      if (snapshot.empty) {
        return [{ name: '_id', type: 'string', nullable: false, primaryKey: true }];
      }

      const fieldMap = new Map<string, string>();
      fieldMap.set('_id', 'string');

      snapshot.forEach(doc => {
        const data = doc.data();
        for (const [key, value] of Object.entries(data)) {
          if (!fieldMap.has(key)) {
            fieldMap.set(key, this.inferFirestoreType(value));
          }
        }
      });

      const columns: IColumn[] = [];
      for (const [name, type] of fieldMap.entries()) {
        columns.push({
          name,
          type,
          nullable: name !== '_id',
          primaryKey: name === '_id'
        });
      }

      return columns;
    } catch (error) {
      return [{ name: '_id', type: 'string', nullable: false, primaryKey: true }];
    }
  }

  async getIndexes(_table: string): Promise<IIndex[]> {
    // Firestore indexes are managed by the Firestore service
    return [];
  }

  async getSchema(): Promise<ISchema> {
    const tables = await this.getTables();

    return {
      databases: [
        {
          name: this._config.projectId || 'default',
          tables,
          views: []
        }
      ]
    };
  }

  async getDatabases(): Promise<string[]> {
    return [this._config.projectId || 'default'];
  }

  async getPrimaryKey(_table: string): Promise<string[]> {
    return ['_id'];
  }

  async getVersion(): Promise<string> {
    return 'Cloud Firestore';
  }

  async getTableData(table: string, options?: { limit?: number; offset?: number }): Promise<IQueryResult> {
    if (!this.firestore) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      let ref: admin.firestore.Query = this.firestore.collection(table);

      if (options?.offset) {
        ref = ref.offset(options.offset);
      }

      ref = ref.limit(options?.limit || 100);

      const snapshot = await ref.get();
      const rows: Record<string, unknown>[] = [];

      snapshot.forEach(doc => {
        rows.push({
          _id: doc.id,
          ...doc.data()
        });
      });

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
    if (!this.firestore) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const docRef = await this.firestore.collection(table).add(data);

      return {
        columns: [],
        rows: [{ _id: docRef.id }],
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
    if (!this.firestore) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const docs = await this.findMatchingDocs(table, where);
      let deletedCount = 0;

      for (const doc of docs) {
        await doc.ref.delete();
        deletedCount++;
      }

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: deletedCount,
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
    if (!this.firestore) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();

    try {
      const docs = await this.findMatchingDocs(table, where);
      let updatedCount = 0;

      for (const doc of docs) {
        await doc.ref.update(data);
        updatedCount++;
      }

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: updatedCount,
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

      if (!this.firestore) {
        return false;
      }

      await this.firestore.listCollections();

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

  protected override getTestQuery(): string {
    return '';
  }

  private async findMatchingDocs(
    table: string,
    where: Record<string, unknown>
  ): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    if (!this.firestore) {
      throw new Error('Not connected to database');
    }

    // If where contains _id, fetch by document ID directly
    if (where._id && Object.keys(where).length === 1) {
      const doc = await this.firestore.collection(table).doc(String(where._id)).get();
      if (doc.exists) {
        return [doc as unknown as admin.firestore.QueryDocumentSnapshot];
      }
      return [];
    }

    let ref: admin.firestore.Query = this.firestore.collection(table);

    for (const [field, value] of Object.entries(where)) {
      if (field === '_id') {
        continue;
      }
      ref = ref.where(field, '==', value);
    }

    const snapshot = await ref.get();
    return snapshot.docs;
  }

  private parseQuery(query: string): {
    collection: string;
    conditions: Array<{ field: string; operator: string; value: unknown }>;
    limit?: number;
    offset?: number;
  } {
    const trimmed = query.trim();

    // Simple format: just collection name
    if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(trimmed)) {
      return { collection: trimmed, conditions: [] };
    }

    // Parse: collection.where(field, op, value).where(...).limit(n)
    const collectionMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)/);
    if (!collectionMatch) {
      return { collection: trimmed, conditions: [] };
    }

    const collection = collectionMatch[1];
    const conditions: Array<{ field: string; operator: string; value: unknown }> = [];
    let limit: number | undefined;
    let offset: number | undefined;

    // Match .where(field, operator, value) patterns
    const whereRegex = /\.where\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*(.+?)\s*\)/g;
    let whereMatch;
    while ((whereMatch = whereRegex.exec(trimmed)) !== null) {
      conditions.push({
        field: whereMatch[1],
        operator: whereMatch[2],
        value: this.parseValue(whereMatch[3])
      });
    }

    // Match .limit(n)
    const limitMatch = trimmed.match(/\.limit\(\s*(\d+)\s*\)/);
    if (limitMatch) {
      limit = parseInt(limitMatch[1], 10);
    }

    // Match .offset(n)
    const offsetMatch = trimmed.match(/\.offset\(\s*(\d+)\s*\)/);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10);
    }

    return { collection, conditions, limit, offset };
  }

  private parseValue(raw: string): unknown {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    // Strip quotes from string values
    const stringMatch = trimmed.match(/^['"](.*)['"]$/);
    if (stringMatch) return stringMatch[1];
    return trimmed;
  }

  private inferColumns(rows: Record<string, unknown>[]): IColumn[] {
    const columnMap = new Map<string, IColumn>();

    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (!columnMap.has(key)) {
          columnMap.set(key, {
            name: key,
            type: this.inferFirestoreType(value),
            nullable: key !== '_id',
            primaryKey: key === '_id'
          });
        }
      }
    }

    return Array.from(columnMap.values());
  }

  private inferFirestoreType(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (value instanceof Date) return 'timestamp';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') {
      if (value && '_seconds' in value && '_nanoseconds' in value) {
        return 'timestamp';
      }
      return 'map';
    }
    return typeof value;
  }
}
