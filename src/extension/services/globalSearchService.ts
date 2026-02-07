import type { ConnectionService } from './connectionService';
import { AdapterFactory } from '../database/factory';

export interface SearchResult {
  connectionId: string;
  connectionName: string;
  type: 'table' | 'column' | 'view' | 'procedure' | 'trigger';
  name: string;
  parent?: string; // table name for columns
  detail?: string;
}

export class GlobalSearchService {
  constructor(private connectionService: ConnectionService) {}

  async search(term: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const lower = term.toLowerCase();
    const connections = this.connectionService.getAllConnections();

    const searchPromises = connections
      .filter(conn => this.connectionService.isConnected(conn.id))
      .map(async (conn) => {
        const adapter = AdapterFactory.get(conn.id);
        if (!adapter?.isConnected()) return;

        try {
          // Search tables
          const tables = await adapter.getTables();
          for (const table of tables) {
            if (table.name.toLowerCase().includes(lower)) {
              results.push({
                connectionId: conn.id,
                connectionName: conn.name,
                type: 'table',
                name: table.name,
                detail: `${table.columns.length} columns`,
              });
            }

            // Search columns
            for (const col of table.columns) {
              if (col.name.toLowerCase().includes(lower)) {
                results.push({
                  connectionId: conn.id,
                  connectionName: conn.name,
                  type: 'column',
                  name: col.name,
                  parent: table.name,
                  detail: col.type,
                });
              }
            }
          }

          // Search views
          if (adapter.getViews) {
            try {
              const views = await adapter.getViews();
              for (const view of views) {
                if (view.name.toLowerCase().includes(lower)) {
                  results.push({
                    connectionId: conn.id,
                    connectionName: conn.name,
                    type: 'view',
                    name: view.name,
                  });
                }
              }
            } catch {
              /* ignore */
            }
          }

          // Search stored procedures
          if (adapter.getStoredProcedures) {
            try {
              const procs = await adapter.getStoredProcedures();
              for (const proc of procs) {
                if (proc.name.toLowerCase().includes(lower)) {
                  results.push({
                    connectionId: conn.id,
                    connectionName: conn.name,
                    type: 'procedure',
                    name: proc.name,
                  });
                }
              }
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore connection errors */
        }
      });

    await Promise.allSettled(searchPromises);
    return results;
  }
}
