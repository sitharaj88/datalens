import type { IDatabaseAdapter } from '../database/interfaces/IAdapter';
import type { DatabaseType } from '../../shared/types/database';

export interface MonitoringStats {
  connectionInfo: {
    serverVersion: string;
    databaseType: string;
  };
  storage: {
    databaseSize?: string;
    tableCount?: number;
    largestTables?: Array<{ name: string; rowCount: number }>;
  };
  performance?: {
    activeConnections?: number;
    maxConnections?: number;
  };
  raw?: Record<string, unknown>;
}

export class MonitoringService {
  async getStats(adapter: IDatabaseAdapter, dbType: DatabaseType): Promise<MonitoringStats> {
    const version = await adapter.getVersion();
    const tables = await adapter.getTables();

    const stats: MonitoringStats = {
      connectionInfo: {
        serverVersion: version,
        databaseType: dbType,
      },
      storage: {
        tableCount: tables.length,
        largestTables: tables
          .filter(t => t.rowCount !== undefined)
          .sort((a, b) => (b.rowCount || 0) - (a.rowCount || 0))
          .slice(0, 10)
          .map(t => ({ name: t.name, rowCount: t.rowCount || 0 })),
      },
    };

    // DB-specific stats
    try {
      switch (dbType) {
        case 'postgresql':
        case 'cockroachdb': {
          const sizeResult = await adapter.executeQuery(
            `SELECT pg_size_pretty(pg_database_size(current_database())) as size`
          );
          if (sizeResult.rows.length > 0) {
            stats.storage.databaseSize = String(sizeResult.rows[0].size);
          }
          const connResult = await adapter.executeQuery(
            `SELECT count(*) as active FROM pg_stat_activity`
          );
          if (connResult.rows.length > 0) {
            stats.performance = {
              activeConnections: Number(connResult.rows[0].active),
            };
          }
          break;
        }
        case 'mysql':
        case 'mariadb': {
          const sizeResult = await adapter.executeQuery(
            `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb FROM information_schema.tables WHERE table_schema = DATABASE()`
          );
          if (sizeResult.rows.length > 0) {
            stats.storage.databaseSize = `${sizeResult.rows[0].size_mb} MB`;
          }
          const connResult = await adapter.executeQuery(`SHOW STATUS LIKE 'Threads_connected'`);
          if (connResult.rows.length > 0) {
            stats.performance = {
              activeConnections: Number(connResult.rows[0].Value || connResult.rows[0].value),
            };
          }
          break;
        }
        case 'sqlite': {
          const pageResult = await adapter.executeQuery(`PRAGMA page_count`);
          const pageSizeResult = await adapter.executeQuery(`PRAGMA page_size`);
          if (pageResult.rows.length > 0 && pageSizeResult.rows.length > 0) {
            const pageCount = Number(pageResult.rows[0].page_count);
            const pageSize = Number(pageSizeResult.rows[0].page_size);
            const sizeBytes = pageCount * pageSize;
            if (sizeBytes < 1024 * 1024) {
              stats.storage.databaseSize = `${(sizeBytes / 1024).toFixed(1)} KB`;
            } else {
              stats.storage.databaseSize = `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`;
            }
          }
          break;
        }
      }
    } catch {
      // Stats queries may fail for some database configurations - that's OK
    }

    return stats;
  }
}
