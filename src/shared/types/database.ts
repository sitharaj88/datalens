export enum DatabaseType {
  SQLite = 'sqlite',
  PostgreSQL = 'postgresql',
  MySQL = 'mysql',
  MSSQL = 'mssql',
  MongoDB = 'mongodb',
  MariaDB = 'mariadb',
  Redis = 'redis',
  CockroachDB = 'cockroachdb',
  Cassandra = 'cassandra',
  Neo4j = 'neo4j',
  ClickHouse = 'clickhouse',
  DynamoDB = 'dynamodb',
  Elasticsearch = 'elasticsearch',
  Firestore = 'firestore',
  OracleDB = 'oracle'
}

export interface IConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  filename?: string;
  connectionString?: string;
  ssl?: boolean | Record<string, unknown>;
  options?: Record<string, unknown>;

  // SSH Tunnel
  sshEnabled?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;

  // Connection Groups
  groupId?: string;
  groupName?: string;
  color?: string;

  // AWS (DynamoDB)
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;

  // Google Cloud (Firestore)
  projectId?: string;
  serviceAccountKey?: string;

  // Neo4j
  neo4jScheme?: 'bolt' | 'bolt+s' | 'neo4j' | 'neo4j+s';
}

export interface IColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: unknown;
  autoIncrement?: boolean;
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

export interface ITable {
  name: string;
  schema?: string;
  columns: IColumn[];
  indexes: IIndex[];
  foreignKeys: IForeignKey[];
  rowCount?: number;
}

export interface IView {
  name: string;
  schema?: string;
  definition?: string;
}

export interface IStoredProcedure {
  name: string;
  schema?: string;
  definition?: string;
  parameters?: IParameter[];
  returnType?: string;
  language?: string;
}

export interface IParameter {
  name: string;
  type: string;
  mode: 'IN' | 'OUT' | 'INOUT';
  defaultValue?: string;
}

export interface ITrigger {
  name: string;
  table: string;
  event: string;
  timing: string;
  definition?: string;
  enabled?: boolean;
}

export interface IQueryPlan {
  plan: unknown;
  textRepresentation: string;
  estimatedCost?: number;
  nodes?: IQueryPlanNode[];
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

export interface IUser {
  name: string;
  host?: string;
  roles?: string[];
  superuser?: boolean;
  canLogin?: boolean;
}

export interface IRole {
  name: string;
  privileges?: string[];
  members?: string[];
}

export interface IDatabase {
  name: string;
  tables: ITable[];
  views: IView[];
}

export interface ISchema {
  databases: IDatabase[];
}

export interface IConnectionGroup {
  id: string;
  name: string;
  color?: string;
  parentId?: string;
  order?: number;
}

export interface ISchemaMetadata {
  tables: Array<{
    name: string;
    schema?: string;
    columns: Array<{ name: string; type: string }>;
  }>;
  views: Array<{
    name: string;
    schema?: string;
    columns: Array<{ name: string; type: string }>;
  }>;
  functions?: string[];
  keywords?: string[];
}

export interface IQueryResult {
  columns: IColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
  executionTime: number;
  error?: string;
}

export interface IQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: Array<{ column: string; direction: 'ASC' | 'DESC' }>;
  where?: Record<string, unknown>;
}

export interface ISavedQuery {
  id: string;
  title: string;
  sql: string;
  description?: string;
  tags: string[];
  connectionId?: string;
  databaseType?: DatabaseType;
  createdAt: number;
  updatedAt: number;
}

export interface IImportOptions {
  tableName: string;
  connectionId: string;
  columnMapping: Record<string, string>;
  batchSize?: number;
  truncateFirst?: boolean;
}

export interface IExportOptions {
  format: 'csv' | 'json' | 'excel' | 'sql' | 'markdown' | 'pdf';
  filename?: string;
  delimiter?: string;
  includeHeaders?: boolean;
}

export interface IMaskingRule {
  pattern: string;
  type: 'full' | 'partial' | 'hash' | 'redact';
  replacement?: string;
}
