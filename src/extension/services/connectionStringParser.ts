import { DatabaseType } from '../../shared/types/database';
import type { IConnectionConfig } from '../../shared/types/database';

const PROTOCOL_MAP: Record<string, DatabaseType> = {
  'postgresql': DatabaseType.PostgreSQL,
  'postgres': DatabaseType.PostgreSQL,
  'mysql': DatabaseType.MySQL,
  'mariadb': DatabaseType.MariaDB,
  'mongodb': DatabaseType.MongoDB,
  'mongodb+srv': DatabaseType.MongoDB,
  'mssql': DatabaseType.MSSQL,
  'sqlserver': DatabaseType.MSSQL,
  'redis': DatabaseType.Redis,
  'rediss': DatabaseType.Redis,
  'neo4j': DatabaseType.Neo4j,
  'bolt': DatabaseType.Neo4j,
  'clickhouse': DatabaseType.ClickHouse,
  'cassandra': DatabaseType.Cassandra,
};

const DEFAULT_PORTS: Partial<Record<DatabaseType, number>> = {
  [DatabaseType.PostgreSQL]: 5432,
  [DatabaseType.MySQL]: 3306,
  [DatabaseType.MariaDB]: 3306,
  [DatabaseType.MongoDB]: 27017,
  [DatabaseType.MSSQL]: 1433,
  [DatabaseType.Redis]: 6379,
  [DatabaseType.Neo4j]: 7687,
  [DatabaseType.ClickHouse]: 8123,
  [DatabaseType.Cassandra]: 9042,
};

export class ConnectionStringParser {
  static parse(uri: string): Partial<IConnectionConfig> | null {
    return new ConnectionStringParser().parseConnectionString(uri);
  }

  parseConnectionString(uri: string): Partial<IConnectionConfig> | null {
    if (!uri || typeof uri !== 'string') {
      return null;
    }

    const trimmedUri = uri.trim();

    try {
      const protocolMatch = trimmedUri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
      if (!protocolMatch) {
        return null;
      }

      const protocol = protocolMatch[1].toLowerCase();
      const dbType = PROTOCOL_MAP[protocol];
      if (!dbType) {
        return null;
      }

      const result: Partial<IConnectionConfig> = {
        type: dbType,
      };

      // Handle mongodb+srv specially since URL class may struggle with +srv
      const normalizedUri = trimmedUri.replace(/^mongodb\+srv:\/\//, 'mongodb+srv://');

      // Use URL for parsing, but replace non-standard protocols with http for parsing
      const parsableUri = normalizedUri.replace(
        /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//,
        'http://'
      );

      const parsed = new URL(parsableUri);

      // Extract credentials (URL-decoded)
      if (parsed.username) {
        result.username = decodeURIComponent(parsed.username);
      }
      if (parsed.password) {
        result.password = decodeURIComponent(parsed.password);
      }

      // Extract host
      if (parsed.hostname) {
        result.host = parsed.hostname;
      }

      // Extract port
      if (parsed.port) {
        result.port = parseInt(parsed.port, 10);
      } else if (dbType && DEFAULT_PORTS[dbType]) {
        result.port = DEFAULT_PORTS[dbType];
      }

      // Extract database name from pathname (strip leading slash)
      const pathname = parsed.pathname;
      if (pathname && pathname.length > 1) {
        result.database = decodeURIComponent(pathname.slice(1));
      }

      // Parse query parameters
      const params = parsed.searchParams;
      this.applyQueryParams(result, params, protocol);

      // Handle SSL for rediss:// protocol
      if (protocol === 'rediss') {
        result.ssl = true;
      }

      return result;
    } catch {
      return null;
    }
  }

  private applyQueryParams(
    config: Partial<IConnectionConfig>,
    params: URLSearchParams,
    protocol: string
  ): void {
    // SSL parameter
    const sslParam = params.get('ssl') ?? params.get('sslmode');
    if (sslParam) {
      const sslEnabled = sslParam === 'true' || sslParam === 'require' || sslParam === 'verify-full' || sslParam === 'verify-ca';
      config.ssl = sslEnabled;
    }

    // Common options stored in the options bag
    const options: Record<string, unknown> = {};

    // MongoDB-specific
    if (config.type === DatabaseType.MongoDB) {
      const authSource = params.get('authSource');
      if (authSource) {
        options['authSource'] = authSource;
      }

      const replicaSet = params.get('replicaSet');
      if (replicaSet) {
        options['replicaSet'] = replicaSet;
      }

      const retryWrites = params.get('retryWrites');
      if (retryWrites) {
        options['retryWrites'] = retryWrites === 'true';
      }

      // mongodb+srv implies SSL
      if (protocol === 'mongodb+srv') {
        config.ssl = config.ssl ?? true;
      }
    }

    // PostgreSQL / MySQL specific
    const schema = params.get('schema') ?? params.get('currentSchema');
    if (schema) {
      options['schema'] = schema;
    }

    const charset = params.get('charset');
    if (charset) {
      options['charset'] = charset;
    }

    const timezone = params.get('timezone');
    if (timezone) {
      options['timezone'] = timezone;
    }

    // MSSQL-specific
    if (config.type === DatabaseType.MSSQL) {
      const encrypt = params.get('encrypt');
      if (encrypt) {
        config.ssl = encrypt === 'true';
      }

      const trustServerCertificate = params.get('trustServerCertificate');
      if (trustServerCertificate) {
        options['trustServerCertificate'] = trustServerCertificate === 'true';
      }

      const instanceName = params.get('instanceName');
      if (instanceName) {
        options['instanceName'] = instanceName;
      }
    }

    // Connection timeout
    const connectTimeout = params.get('connectTimeout') ?? params.get('connect_timeout');
    if (connectTimeout) {
      options['connectTimeout'] = parseInt(connectTimeout, 10);
    }

    // Apply options only if we collected any
    if (Object.keys(options).length > 0) {
      config.options = { ...config.options, ...options };
    }
  }
}
