export const DEFAULT_PORT: Record<string, number> = {
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  mssql: 1433,
  mongodb: 27017,
  redis: 6379,
  cockroachdb: 26257,
  cassandra: 9042,
  neo4j: 7687,
  clickhouse: 8123,
  dynamodb: 8000,
  elasticsearch: 9200,
  firestore: 8080,
  oracle: 1521
};

export const DATABASE_ICONS: Record<string, string> = {
  sqlite: 'database',
  postgresql: 'database',
  mysql: 'database',
  mariadb: 'database',
  mssql: 'database',
  mongodb: 'database',
  redis: 'database',
  cockroachdb: 'database',
  cassandra: 'database',
  neo4j: 'database',
  clickhouse: 'database',
  dynamodb: 'database',
  elasticsearch: 'database',
  firestore: 'database',
  oracle: 'database'
};

export const DATABASE_LABELS: Record<string, string> = {
  sqlite: 'SQLite',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mssql: 'SQL Server',
  mongodb: 'MongoDB',
  redis: 'Redis',
  cockroachdb: 'CockroachDB',
  cassandra: 'Cassandra',
  neo4j: 'Neo4j',
  clickhouse: 'ClickHouse',
  dynamodb: 'DynamoDB',
  elasticsearch: 'Elasticsearch',
  firestore: 'Firestore',
  oracle: 'Oracle'
};

export const DEFAULT_QUERY_LIMIT = 1000;
export const DEFAULT_QUERY_TIMEOUT = 30000;
export const SCHEMA_CACHE_TTL = 60000;

export const ENV_PATTERNS = {
  DATABASE_URL: /^(DATABASE_URL|DB_URL|DB_CONNECTION_STRING)$/i,
  DB_HOST: /^(DB_HOST|DATABASE_HOST|MYSQL_HOST|PG_HOST|POSTGRES_HOST)$/i,
  DB_PORT: /^(DB_PORT|DATABASE_PORT|MYSQL_PORT|PG_PORT|POSTGRES_PORT)$/i,
  DB_NAME: /^(DB_NAME|DB_DATABASE|DATABASE_NAME|MYSQL_DATABASE|PG_DATABASE|POSTGRES_DB)$/i,
  DB_USER: /^(DB_USER|DB_USERNAME|DATABASE_USER|MYSQL_USER|PG_USER|POSTGRES_USER)$/i,
  DB_PASSWORD: /^(DB_PASSWORD|DB_PASS|DATABASE_PASSWORD|MYSQL_PASSWORD|PG_PASSWORD|POSTGRES_PASSWORD)$/i
};

export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'ON',
  'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL',
  'ORDER', 'BY', 'ASC', 'DESC', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'ALL', 'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'SAVEPOINT',
  'GRANT', 'REVOKE', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'CONSTRAINT', 'CHECK', 'DEFAULT', 'UNIQUE', 'AUTO_INCREMENT',
  'EXPLAIN', 'ANALYZE', 'VACUUM', 'TRUNCATE', 'IF', 'ELSE',
  'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EXECUTE', 'CALL',
  'WITH', 'RECURSIVE', 'RETURNING', 'CONFLICT', 'DO', 'NOTHING'
];
