import type { ISchemaMetadata } from '../../shared/types/database';
import { AdapterFactory } from '../database/factory';

interface CachedSchema {
  metadata: ISchemaMetadata;
  timestamp: number;
}

export class SchemaCache {
  private static instance: SchemaCache;
  private cache = new Map<string, CachedSchema>();
  private readonly TTL = 60000; // 1 minute

  static getInstance(): SchemaCache {
    if (!SchemaCache.instance) {
      SchemaCache.instance = new SchemaCache();
    }
    return SchemaCache.instance;
  }

  async getMetadata(connectionId: string, database?: string): Promise<ISchemaMetadata | null> {
    const key = `${connectionId}:${database || 'default'}`;
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.metadata;
    }

    try {
      const adapter = AdapterFactory.get(connectionId);
      if (!adapter?.isConnected()) {
        return null;
      }

      let metadata: ISchemaMetadata;

      if (adapter.getSchemaMetadata) {
        metadata = await adapter.getSchemaMetadata(database);
      } else {
        // Fallback: build metadata from getTables + getColumns
        const tables = await adapter.getTables(database);
        const tableMetadata = await Promise.all(
          tables.map(async (table) => {
            try {
              const columns = await adapter.getColumns(table.name);
              return {
                name: table.name,
                columns: columns.map(c => ({ name: c.name, type: c.type }))
              };
            } catch {
              return {
                name: table.name,
                columns: (table.columns || []).map(c => ({ name: c.name, type: c.type }))
              };
            }
          })
        );

        let views: Array<{ name: string; schema?: string; columns: Array<{ name: string; type: string }> }> = [];
        if (adapter.getViews) {
          try {
            const viewList = await adapter.getViews(database);
            views = viewList.map(v => ({ name: v.name, schema: v.schema, columns: [] }));
          } catch { /* ignore */ }
        }

        metadata = { tables: tableMetadata, views };
      }

      this.cache.set(key, { metadata, timestamp: Date.now() });
      return metadata;
    } catch {
      return null;
    }
  }

  invalidate(connectionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
