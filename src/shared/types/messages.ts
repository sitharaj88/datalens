import type { IConnectionConfig, IQueryResult, IQueryOptions, ITable, IColumn, ISchemaMetadata, IQueryPlan, IStoredProcedure, ITrigger, IView, IUser, IRole, ISavedQuery, IExportOptions, IImportOptions } from './database';

export type MessageType =
  | 'CONNECT'
  | 'DISCONNECT'
  | 'EXECUTE_QUERY'
  | 'GET_SCHEMA'
  | 'GET_TABLE_DATA'
  | 'GET_COLUMNS'
  | 'INSERT_ROW'
  | 'UPDATE_ROW'
  | 'DELETE_ROW'
  | 'EXPORT_DATA'
  | 'DISCOVER_CONNECTIONS'
  | 'GET_CONNECTIONS'
  | 'THEME_CHANGED'
  | 'READY'
  // Transaction
  | 'BEGIN_TRANSACTION'
  | 'COMMIT_TRANSACTION'
  | 'ROLLBACK_TRANSACTION'
  // Schema metadata
  | 'GET_SCHEMA_METADATA'
  | 'GET_FULL_SCHEMA'
  // Schema objects
  | 'GET_STORED_PROCEDURES'
  | 'GET_TRIGGERS'
  | 'GET_VIEWS'
  | 'GET_VIEW_DEFINITION'
  | 'GET_USERS'
  | 'GET_ROLES'
  | 'GET_DATABASES'
  // Query plan
  | 'EXPLAIN_QUERY'
  // Bookmarks
  | 'SAVE_QUERY'
  | 'GET_SAVED_QUERIES'
  | 'DELETE_SAVED_QUERY'
  // Import
  | 'IMPORT_DATA'
  | 'IMPORT_PROGRESS'
  // AI
  | 'NL_TO_SQL'
  | 'SUGGEST_OPTIMIZATIONS'
  // Table design
  | 'GENERATE_DDL'
  | 'EXECUTE_DDL'
  // Schema compare
  | 'COMPARE_SCHEMAS'
  // Mock data
  | 'GENERATE_MOCK_DATA'
  // Monitoring
  | 'GET_MONITORING_STATS'
  // Backup
  | 'BACKUP_DATABASE'
  | 'RESTORE_DATABASE'
  // Global search
  | 'GLOBAL_SEARCH'
  // Lint
  | 'LINT_SQL'
  // File save
  | 'SAVE_FILE'
  // Database capabilities
  | 'GET_DATABASE_CAPABILITIES';

export interface Message<T = unknown> {
  type: MessageType;
  id: string;
  payload: T;
}

export interface Response<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: string;
}

export interface ConnectPayload {
  connectionId: string;
}

export interface ExecuteQueryPayload {
  connectionId: string;
  sql: string;
  params?: unknown[];
}

export interface GetTableDataPayload {
  connectionId: string;
  table: string;
  schema?: string;
  options?: IQueryOptions;
}

export interface GetColumnsPayload {
  connectionId: string;
  table: string;
  schema?: string;
}

export interface InsertRowPayload {
  connectionId: string;
  table: string;
  schema?: string;
  data: Record<string, unknown>;
}

export interface UpdateRowPayload {
  connectionId: string;
  table: string;
  schema?: string;
  data: Record<string, unknown>;
  where: Record<string, unknown>;
}

export interface DeleteRowPayload {
  connectionId: string;
  table: string;
  schema?: string;
  where: Record<string, unknown>;
}

export interface ExportDataPayload {
  connectionId: string;
  table?: string;
  sql?: string;
  format: 'csv' | 'json' | 'excel' | 'sql' | 'markdown' | 'pdf';
  filename?: string;
}

export interface TransactionPayload {
  connectionId: string;
}

export interface SchemaMetadataPayload {
  connectionId: string;
  database?: string;
}

export interface ExplainQueryPayload {
  connectionId: string;
  sql: string;
}

export interface SaveQueryPayload {
  query: ISavedQuery;
}

export interface NLToSQLPayload {
  connectionId: string;
  prompt: string;
}

export interface GenerateDDLPayload {
  connectionId: string;
  tableDefinition: unknown;
}

export interface CompareSchemaPayload {
  sourceConnectionId: string;
  targetConnectionId: string;
  database?: string;
}

export interface GenerateMockDataPayload {
  connectionId: string;
  table: string;
  rowCount: number;
  columnOverrides?: Record<string, string>;
}

export interface GlobalSearchPayload {
  query: string;
  connectionIds?: string[];
  searchType: 'tables' | 'columns' | 'data' | 'all';
}

export interface LintSQLPayload {
  connectionId: string;
  sql: string;
}

export interface MonitoringPayload {
  connectionId: string;
}

export interface BackupPayload {
  connectionId: string;
  outputPath: string;
  options?: Record<string, unknown>;
}

export type WebviewMessage =
  | Message<ConnectPayload>
  | Message<ExecuteQueryPayload>
  | Message<GetTableDataPayload>
  | Message<GetColumnsPayload>
  | Message<InsertRowPayload>
  | Message<UpdateRowPayload>
  | Message<DeleteRowPayload>
  | Message<ExportDataPayload>
  | Message<TransactionPayload>
  | Message<SchemaMetadataPayload>
  | Message<ExplainQueryPayload>
  | Message<SaveQueryPayload>
  | Message<NLToSQLPayload>
  | Message<GlobalSearchPayload>
  | Message<LintSQLPayload>
  | Message<MonitoringPayload>
  | Message<BackupPayload>
  | Message<void>;

export type ExtensionMessage =
  | Response<IQueryResult>
  | Response<ITable[]>
  | Response<IColumn[]>
  | Response<IConnectionConfig[]>
  | Response<ISchemaMetadata>
  | Response<IQueryPlan>
  | Response<IStoredProcedure[]>
  | Response<ITrigger[]>
  | Response<IView[]>
  | Response<IUser[]>
  | Response<IRole[]>
  | Response<ISavedQuery[]>
  | Response<string>
  | Response<void>;
