export interface IColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: unknown;
  autoIncrement?: boolean;
  foreignKey?: { table: string; column: string };
}

export interface IIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface IForeignKey {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface IQueryResult {
  columns: IColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
  executionTime: number;
  error?: string;
}

export interface IConnectionConfig {
  id: string;
  name: string;
  type: string;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  color?: string;
}

export interface IView {
  name: string;
  schema?: string;
  definition?: string;
}

export interface IStoredProcedure {
  name: string;
  schema?: string;
  returnType?: string;
}

export interface ITrigger {
  name: string;
  table: string;
  event: string;
  timing: string;
  enabled?: boolean;
}

export interface IQueryPlanNode {
  type: string;
  description: string;
  cost?: number;
  rows?: number;
  width?: number;
  children?: IQueryPlanNode[];
  properties?: Record<string, unknown>;
}

export interface IQueryPlan {
  plan: unknown;
  textRepresentation?: string;
  estimatedCost?: number;
  nodes?: IQueryPlanNode[];
}

export interface ISavedQuery {
  id: string;
  name: string;
  query: string;
  connectionId?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ISchemaMetadata {
  tables: Array<{ name: string; schema?: string; columns: Array<{ name: string; type: string; nullable?: boolean; primaryKey?: boolean }> }>;
  views?: Array<{ name: string; schema?: string; columns: Array<{ name: string; type: string; nullable?: boolean; primaryKey?: boolean }> }>;
  functions?: string[];
  keywords?: string[];
  databases?: string[];
}

export type MessageType =
  | 'EXECUTE_QUERY'
  | 'GET_TABLE_DATA'
  | 'GET_COLUMNS'
  | 'INSERT_ROW'
  | 'UPDATE_ROW'
  | 'DELETE_ROW'
  | 'GET_CONNECTIONS'
  | 'BEGIN_TRANSACTION'
  | 'COMMIT_TRANSACTION'
  | 'ROLLBACK_TRANSACTION'
  | 'GET_SCHEMA_METADATA'
  | 'GET_FULL_SCHEMA'
  | 'GET_STORED_PROCEDURES'
  | 'GET_TRIGGERS'
  | 'GET_VIEWS'
  | 'GET_VIEW_DEFINITION'
  | 'GET_USERS'
  | 'GET_ROLES'
  | 'GET_DATABASES'
  | 'EXPLAIN_QUERY'
  | 'SAVE_QUERY'
  | 'GET_SAVED_QUERIES'
  | 'DELETE_SAVED_QUERY'
  | 'NL_TO_SQL'
  | 'SUGGEST_OPTIMIZATIONS'
  | 'GENERATE_DDL'
  | 'EXECUTE_DDL'
  | 'EXPORT_DATA'
  | 'IMPORT_DATA'
  | 'IMPORT_PROGRESS'
  | 'COMPARE_SCHEMAS'
  | 'GENERATE_MOCK_DATA'
  | 'GET_MONITORING_STATS'
  | 'BACKUP_DATABASE'
  | 'RESTORE_DATABASE'
  | 'GLOBAL_SEARCH'
  | 'LINT_SQL'
  | 'SAVE_FILE';

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
