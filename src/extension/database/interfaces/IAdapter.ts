import type {
  IConnectionConfig,
  ISchema,
  ITable,
  IColumn,
  IIndex,
  IQueryResult,
  IQueryOptions,
  DatabaseType,
  IStoredProcedure,
  ITrigger,
  IView,
  IQueryPlan,
  IUser,
  IRole,
  ISchemaMetadata
} from '../../../shared/types/database';

export interface IDatabaseAdapter {
  readonly config: IConnectionConfig;

  connect(): Promise<void>;

  disconnect(): Promise<void>;

  testConnection(): Promise<boolean>;

  isConnected(): boolean;

  getSchema(): Promise<ISchema>;

  getTables(database?: string): Promise<ITable[]>;

  getColumns(table: string, schema?: string): Promise<IColumn[]>;

  getIndexes(table: string, schema?: string): Promise<IIndex[]>;

  getPrimaryKey(table: string, schema?: string): Promise<string[]>;

  executeQuery(sql: string, params?: unknown[]): Promise<IQueryResult>;

  getTableData(table: string, options?: IQueryOptions): Promise<IQueryResult>;

  insertRow(table: string, data: Record<string, unknown>): Promise<IQueryResult>;

  updateRow(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<IQueryResult>;

  deleteRow(table: string, where: Record<string, unknown>): Promise<IQueryResult>;

  getVersion(): Promise<string>;

  getDatabaseType(): DatabaseType;

  // Transaction support
  beginTransaction?(): Promise<void>;
  commitTransaction?(): Promise<void>;
  rollbackTransaction?(): Promise<void>;

  // Schema objects
  getStoredProcedures?(database?: string): Promise<IStoredProcedure[]>;
  getTriggers?(table?: string, schema?: string): Promise<ITrigger[]>;
  getViews?(database?: string): Promise<IView[]>;
  getViewDefinition?(viewName: string, schema?: string): Promise<string>;

  // Query plan
  explainQuery?(sql: string): Promise<IQueryPlan>;

  // User management
  getUsers?(): Promise<IUser[]>;
  getRoles?(): Promise<IRole[]>;

  // Database introspection
  getDatabases?(): Promise<string[]>;
  getSchemas?(database?: string): Promise<string[]>;

  // Schema metadata for autocomplete
  getSchemaMetadata?(database?: string): Promise<ISchemaMetadata>;
}

export type { IConnectionConfig, ISchema, ITable, IColumn, IIndex, IQueryResult, IQueryOptions };
