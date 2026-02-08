import type { IDatabaseAdapter } from '../database/interfaces/IAdapter';
import { DatabaseType, type DatabaseCapabilities, type QueryLanguage } from '../../shared/types/database';

export function buildCapabilities(adapter: IDatabaseAdapter): DatabaseCapabilities {
  const dbType = adapter.getDatabaseType();

  const queryLanguage = getQueryLanguage(dbType);
  const editorLanguageId = getEditorLanguageId(queryLanguage);

  return {
    databaseType: dbType,
    queryLanguage,
    editorLanguageId,
    placeholderText: getPlaceholderText(dbType),
    label: getEditorLabel(dbType),
    supportsExplain: typeof adapter.explainQuery === 'function',
    supportsTransactions: typeof adapter.beginTransaction === 'function',
    supportsSqlLint: queryLanguage === 'sql',
    supportsSqlFormat: queryLanguage === 'sql',
    supportsStoredProcedures: typeof adapter.getStoredProcedures === 'function',
    supportsTriggers: typeof adapter.getTriggers === 'function',
    supportsViews: typeof adapter.getViews === 'function',
    supportsMultiStatement: queryLanguage === 'sql',
  };
}

function getQueryLanguage(dbType: DatabaseType): QueryLanguage {
  switch (dbType) {
    case DatabaseType.MongoDB:
    case DatabaseType.Elasticsearch:
    case DatabaseType.DynamoDB:
    case DatabaseType.Firestore:
      return 'json';
    case DatabaseType.Neo4j:
      return 'cypher';
    case DatabaseType.Redis:
      return 'plaintext';
    case DatabaseType.Cassandra:
      return 'cql';
    default:
      return 'sql';
  }
}

function getEditorLanguageId(lang: QueryLanguage): string {
  switch (lang) {
    case 'json':
      return 'json';
    case 'cypher':
    case 'cql':
    case 'plaintext':
      return 'plaintext';
    default:
      return 'sql';
  }
}

function getPlaceholderText(dbType: DatabaseType): string {
  switch (dbType) {
    case DatabaseType.MongoDB:
      return 'Enter MongoDB query (JSON)...';
    case DatabaseType.Elasticsearch:
      return 'Enter Elasticsearch query (JSON)...';
    case DatabaseType.Neo4j:
      return 'Enter Cypher query...';
    case DatabaseType.Redis:
      return 'Enter Redis command...';
    case DatabaseType.Cassandra:
      return 'Enter CQL query...';
    case DatabaseType.DynamoDB:
      return 'Enter DynamoDB query (JSON)...';
    case DatabaseType.Firestore:
      return 'Enter Firestore query (JSON)...';
    default:
      return 'Enter SQL query...';
  }
}

function getEditorLabel(dbType: DatabaseType): string {
  switch (dbType) {
    case DatabaseType.MongoDB:
      return 'MongoDB Editor';
    case DatabaseType.Elasticsearch:
      return 'Elasticsearch Editor';
    case DatabaseType.Neo4j:
      return 'Cypher Editor';
    case DatabaseType.Redis:
      return 'Redis Editor';
    case DatabaseType.Cassandra:
      return 'CQL Editor';
    case DatabaseType.DynamoDB:
      return 'DynamoDB Editor';
    case DatabaseType.Firestore:
      return 'Firestore Editor';
    default:
      return 'SQL Editor';
  }
}
