import type { IDatabaseAdapter, IConnectionConfig } from './interfaces/IAdapter';
import { DatabaseType } from '../../shared/types/database';

// Adapters are lazy-loaded to avoid requiring native driver packages at activation time.
// Only the adapter for the requested database type is loaded when create() is called.

export class AdapterFactory {
  private static adapters = new Map<string, IDatabaseAdapter>();

  static create(config: IConnectionConfig): IDatabaseAdapter {
    const existingAdapter = this.adapters.get(config.id);
    if (existingAdapter) {
      return existingAdapter;
    }

    let adapter: IDatabaseAdapter;

    switch (config.type) {
      case DatabaseType.SQLite: {
        const { SQLiteAdapter } = require('./adapters/sqliteAdapter');
        adapter = new SQLiteAdapter(config);
        break;
      }
      case DatabaseType.PostgreSQL: {
        const { PostgresAdapter } = require('./adapters/postgresAdapter');
        adapter = new PostgresAdapter(config);
        break;
      }
      case DatabaseType.MySQL: {
        const { MySQLAdapter } = require('./adapters/mysqlAdapter');
        adapter = new MySQLAdapter(config);
        break;
      }
      case DatabaseType.MSSQL: {
        const { MSSQLAdapter } = require('./adapters/mssqlAdapter');
        adapter = new MSSQLAdapter(config);
        break;
      }
      case DatabaseType.MongoDB: {
        const { MongoAdapter } = require('./adapters/mongoAdapter');
        adapter = new MongoAdapter(config);
        break;
      }
      case DatabaseType.MariaDB: {
        const { MariaDBAdapter } = require('./adapters/mariadbAdapter');
        adapter = new MariaDBAdapter(config);
        break;
      }
      case DatabaseType.Redis: {
        const { RedisAdapter } = require('./adapters/redisAdapter');
        adapter = new RedisAdapter(config);
        break;
      }
      case DatabaseType.CockroachDB: {
        const { CockroachDBAdapter } = require('./adapters/cockroachdbAdapter');
        adapter = new CockroachDBAdapter(config);
        break;
      }
      case DatabaseType.Neo4j: {
        const { Neo4jAdapter } = require('./adapters/neo4jAdapter');
        adapter = new Neo4jAdapter(config);
        break;
      }
      case DatabaseType.ClickHouse: {
        const { ClickHouseAdapter } = require('./adapters/clickhouseAdapter');
        adapter = new ClickHouseAdapter(config);
        break;
      }
      case DatabaseType.Cassandra: {
        const { CassandraAdapter } = require('./adapters/cassandraAdapter');
        adapter = new CassandraAdapter(config);
        break;
      }
      case DatabaseType.DynamoDB: {
        const { DynamoDBAdapter } = require('./adapters/dynamodbAdapter');
        adapter = new DynamoDBAdapter(config);
        break;
      }
      case DatabaseType.Elasticsearch: {
        const { ElasticsearchAdapter } = require('./adapters/elasticsearchAdapter');
        adapter = new ElasticsearchAdapter(config);
        break;
      }
      case DatabaseType.Firestore: {
        const { FirestoreAdapter } = require('./adapters/firestoreAdapter');
        adapter = new FirestoreAdapter(config);
        break;
      }
      case DatabaseType.OracleDB: {
        const { OracleAdapter } = require('./adapters/oracleAdapter');
        adapter = new OracleAdapter(config);
        break;
      }
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }

    this.adapters.set(config.id, adapter);
    return adapter;
  }

  static get(connectionId: string): IDatabaseAdapter | undefined {
    return this.adapters.get(connectionId);
  }

  static remove(connectionId: string): void {
    const adapter = this.adapters.get(connectionId);
    if (adapter) {
      adapter.disconnect().catch(() => {});
      this.adapters.delete(connectionId);
    }
  }

  static async disconnectAll(): Promise<void> {
    const promises = Array.from(this.adapters.values()).map(adapter =>
      adapter.disconnect().catch(() => {})
    );
    await Promise.all(promises);
    this.adapters.clear();
  }

  static getConnectedAdapters(): IDatabaseAdapter[] {
    return Array.from(this.adapters.values()).filter(adapter => adapter.isConnected());
  }
}
