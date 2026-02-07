import type { ConnectionService } from './connectionService';
import { AdapterFactory } from '../database/factory';
import type { Message, Response } from '../../shared/types/messages';
import type { IDatabaseAdapter } from '../database/interfaces/IAdapter';
import { SchemaCache } from './schemaCache';
import { SQLLintService } from './sqlLintService';
import { ExportService } from './exportService';
import { ImportService } from './importService';
import { DDLGenerator, type TableDefinition } from './ddlGenerator';
import { SchemaComparisonService } from './schemaComparisonService';
import { MockDataService } from './mockDataService';
import { MonitoringService } from './monitoringService';
import { BackupRestoreService } from './backupRestoreService';
import type { AIService } from './aiService';
import type { QueryBookmarkService } from './queryBookmarkService';
import type { GlobalSearchService } from './globalSearchService';
import type { DatabaseType } from '../../shared/types/database';

export class MessageRouter {
  private lintService = new SQLLintService();
  private exportService = new ExportService();
  private importService = new ImportService();
  private ddlGenerator = new DDLGenerator();
  private schemaComparisonService = new SchemaComparisonService();
  private mockDataService = new MockDataService();
  private monitoringService = new MonitoringService();
  private backupRestoreService = new BackupRestoreService();
  private aiService: AIService | null = null;
  private bookmarkService: QueryBookmarkService | null = null;
  private globalSearchService: GlobalSearchService | null = null;

  constructor(private connectionService: ConnectionService) {}

  setAIService(service: AIService): void {
    this.aiService = service;
  }

  setBookmarkService(service: QueryBookmarkService): void {
    this.bookmarkService = service;
  }

  setGlobalSearchService(service: GlobalSearchService): void {
    this.globalSearchService = service;
  }

  async route(message: Message, onProgress?: (data: unknown) => void): Promise<Response> {
    const response: Response = {
      id: message.id,
      success: false
    };

    try {
      switch (message.type) {
        case 'EXECUTE_QUERY': {
          const { connectionId, sql } = message.payload as { connectionId: string; sql: string };
          const adapter = this.getConnectedAdapter(connectionId);
          const result = await adapter.executeQuery(sql);
          response.success = !result.error;
          response.data = result;
          response.error = result.error;
          break;
        }

        case 'GET_TABLE_DATA': {
          const { connectionId, table, options } = message.payload as {
            connectionId: string;
            table: string;
            options?: { limit?: number; offset?: number };
          };
          const adapter = this.getConnectedAdapter(connectionId);
          const result = await adapter.getTableData(table, options);
          response.success = !result.error;
          response.data = result;
          response.error = result.error;
          break;
        }

        case 'GET_CONNECTIONS': {
          const connections = this.connectionService.getAllConnections()
            .filter(conn => this.connectionService.isConnected(conn.id));
          response.success = true;
          response.data = connections;
          break;
        }

        case 'GET_COLUMNS': {
          const { connectionId, table } = message.payload as {
            connectionId: string;
            table: string;
          };
          const adapter = this.getConnectedAdapter(connectionId);
          const columns = await adapter.getColumns(table);
          response.success = true;
          response.data = columns;
          break;
        }

        case 'INSERT_ROW': {
          const { connectionId, table, data } = message.payload as {
            connectionId: string;
            table: string;
            data: Record<string, unknown>;
          };
          const adapter = this.getConnectedAdapter(connectionId);
          const result = await adapter.insertRow(table, data);
          response.success = !result.error;
          response.data = result;
          response.error = result.error;
          break;
        }

        case 'UPDATE_ROW': {
          const { connectionId, table, data, where } = message.payload as {
            connectionId: string;
            table: string;
            data: Record<string, unknown>;
            where: Record<string, unknown>;
          };
          const adapter = this.getConnectedAdapter(connectionId);
          const result = await adapter.updateRow(table, data, where);
          response.success = !result.error;
          response.data = result;
          response.error = result.error;
          break;
        }

        case 'DELETE_ROW': {
          const { connectionId, table, where } = message.payload as {
            connectionId: string;
            table: string;
            where: Record<string, unknown>;
          };
          const adapter = this.getConnectedAdapter(connectionId);
          const result = await adapter.deleteRow(table, where);
          response.success = !result.error;
          response.data = result;
          response.error = result.error;
          break;
        }

        // Transaction support
        case 'BEGIN_TRANSACTION': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.beginTransaction) {
            await adapter.beginTransaction();
            response.success = true;
          } else {
            response.error = 'Transactions not supported for this database';
          }
          break;
        }

        case 'COMMIT_TRANSACTION': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.commitTransaction) {
            await adapter.commitTransaction();
            response.success = true;
          } else {
            response.error = 'Transactions not supported for this database';
          }
          break;
        }

        case 'ROLLBACK_TRANSACTION': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.rollbackTransaction) {
            await adapter.rollbackTransaction();
            response.success = true;
          } else {
            response.error = 'Transactions not supported for this database';
          }
          break;
        }

        // Schema metadata
        case 'GET_SCHEMA_METADATA': {
          const { connectionId, database } = message.payload as {
            connectionId: string;
            database?: string;
          };
          const schemaCache = SchemaCache.getInstance();
          const metadata = await schemaCache.getMetadata(connectionId, database);
          if (metadata) {
            response.success = true;
            response.data = metadata;
          } else {
            response.error = 'Failed to retrieve schema metadata';
          }
          break;
        }

        case 'GET_FULL_SCHEMA': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          const schema = await adapter.getSchema();
          response.success = true;
          response.data = schema;
          break;
        }

        // Schema objects
        case 'GET_STORED_PROCEDURES': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.getStoredProcedures) {
            const procs = await adapter.getStoredProcedures();
            response.success = true;
            response.data = procs;
          } else {
            response.success = true;
            response.data = [];
          }
          break;
        }

        case 'GET_TRIGGERS': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.getTriggers) {
            const triggers = await adapter.getTriggers();
            response.success = true;
            response.data = triggers;
          } else {
            response.success = true;
            response.data = [];
          }
          break;
        }

        case 'GET_VIEWS': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.getViews) {
            const views = await adapter.getViews();
            response.success = true;
            response.data = views;
          } else {
            response.success = true;
            response.data = [];
          }
          break;
        }

        case 'GET_VIEW_DEFINITION': {
          const { connectionId, viewName } = message.payload as {
            connectionId: string;
            viewName: string;
          };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.getViewDefinition) {
            const def = await adapter.getViewDefinition(viewName);
            response.success = true;
            response.data = def;
          } else {
            response.error = 'View definitions not supported';
          }
          break;
        }

        case 'GET_USERS': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.getUsers) {
            const users = await adapter.getUsers();
            response.success = true;
            response.data = users;
          } else {
            response.success = true;
            response.data = [];
          }
          break;
        }

        case 'GET_ROLES': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.getRoles) {
            const roles = await adapter.getRoles();
            response.success = true;
            response.data = roles;
          } else {
            response.success = true;
            response.data = [];
          }
          break;
        }

        case 'GET_DATABASES': {
          const { connectionId } = message.payload as { connectionId: string };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.getDatabases) {
            const databases = await adapter.getDatabases();
            response.success = true;
            response.data = databases;
          } else {
            response.success = true;
            response.data = [];
          }
          break;
        }

        // Query plan
        case 'EXPLAIN_QUERY': {
          const { connectionId, sql } = message.payload as {
            connectionId: string;
            sql: string;
          };
          const adapter = this.getConnectedAdapter(connectionId);
          if (adapter.explainQuery) {
            const plan = await adapter.explainQuery(sql);
            response.success = true;
            response.data = plan;
          } else {
            response.error = 'Query plan not supported for this database';
          }
          break;
        }

        // SQL Linting
        case 'LINT_SQL': {
          const { sql } = message.payload as { connectionId: string; sql: string };
          const warnings = this.lintService.lint(sql);
          response.success = true;
          response.data = warnings;
          break;
        }

        // AI: Natural Language to SQL
        case 'NL_TO_SQL': {
          const { connectionId, prompt } = message.payload as {
            connectionId: string;
            prompt: string;
          };
          if (!this.aiService?.isConfigured()) {
            response.error = 'AI provider not configured. Set up your API key in Settings > Database Viewer > AI.';
            break;
          }
          const schemaCache = SchemaCache.getInstance();
          const metadata = await schemaCache.getMetadata(connectionId);
          const schemaContext = metadata ? this.aiService.formatSchemaContext(metadata) : '';
          const sql = await this.aiService.naturalLanguageToSQL(prompt, schemaContext);
          response.success = true;
          response.data = sql;
          break;
        }

        // AI: Suggest Optimizations
        case 'SUGGEST_OPTIMIZATIONS': {
          const { connectionId, sql } = message.payload as { connectionId: string; sql: string };
          if (!this.aiService?.isConfigured()) {
            response.error = 'AI provider not configured.';
            break;
          }
          const schemaCacheOpt = SchemaCache.getInstance();
          const metadataOpt = await schemaCacheOpt.getMetadata(connectionId);
          const schemaContextOpt = metadataOpt ? this.aiService.formatSchemaContext(metadataOpt) : '';
          const suggestions = await this.aiService.suggestOptimizations(sql, schemaContextOpt);
          response.success = true;
          response.data = suggestions;
          break;
        }

        // Query Bookmarks
        case 'SAVE_QUERY': {
          const { name, query, connectionId: connId, tags } = message.payload as {
            name: string;
            query: string;
            connectionId?: string;
            tags?: string[];
          };
          if (!this.bookmarkService) {
            response.error = 'Bookmark service not available';
            break;
          }
          const saved = await this.bookmarkService.save({ name, query, connectionId: connId, tags: tags || [] });
          response.success = true;
          response.data = saved;
          break;
        }

        case 'GET_SAVED_QUERIES': {
          if (!this.bookmarkService) {
            response.success = true;
            response.data = [];
            break;
          }
          const queries = this.bookmarkService.getAll();
          response.success = true;
          response.data = queries;
          break;
        }

        case 'DELETE_SAVED_QUERY': {
          const { id } = message.payload as { id: string };
          if (!this.bookmarkService) {
            response.error = 'Bookmark service not available';
            break;
          }
          await this.bookmarkService.delete(id);
          response.success = true;
          break;
        }

        // Export Data
        case 'EXPORT_DATA': {
          const { connectionId, table, sql, format, filename } = message.payload as {
            connectionId: string;
            table?: string;
            sql?: string;
            format: string;
            filename?: string;
          };
          const adapter = this.getConnectedAdapter(connectionId);
          let exportResult;
          if (sql) {
            exportResult = await adapter.executeQuery(sql);
          } else if (table) {
            exportResult = await adapter.getTableData(table);
          } else {
            throw new Error('Either table or sql must be provided for export');
          }
          const supportedFormats = ['csv', 'json', 'excel'];
          if (supportedFormats.includes(format)) {
            const filePath = await this.exportService.exportData(exportResult, {
              format: format as 'csv' | 'json' | 'excel',
              filename,
            });
            response.success = true;
            response.data = filePath;
          } else {
            response.error = `Export format '${format}' not yet supported via backend. Use client-side export.`;
          }
          break;
        }

        // Import Data
        case 'IMPORT_DATA': {
          const importPayload = message.payload as {
            connectionId: string;
            filePath?: string;
            data?: string;
            format: 'csv' | 'json';
            tableName: string;
            columnMapping?: Record<string, string>;
            batchSize?: number;
            skipErrors?: boolean;
            hasHeaders?: boolean;
            preview?: boolean;
          };
          const importAdapter = this.getConnectedAdapter(importPayload.connectionId);

          if (importPayload.preview && importPayload.data) {
            const previewData = this.importService.preview(importPayload.data, importPayload.format);
            response.success = true;
            response.data = previewData;
            break;
          }

          const importOptions = {
            format: importPayload.format,
            tableName: importPayload.tableName,
            columnMapping: importPayload.columnMapping,
            batchSize: importPayload.batchSize,
            skipErrors: importPayload.skipErrors,
            hasHeaders: importPayload.hasHeaders,
          };

          const progressCallback = onProgress ? (p: unknown) => {
            onProgress({ type: 'IMPORT_PROGRESS', id: message.id, data: p });
          } : undefined;

          let importProgress;
          if (importPayload.filePath) {
            importProgress = await this.importService.importFile(importPayload.filePath, importAdapter, importOptions, progressCallback);
          } else if (importPayload.data) {
            importProgress = await this.importService.importData(importPayload.data, importAdapter, importOptions, progressCallback);
          } else {
            throw new Error('Either filePath or data must be provided');
          }

          response.success = true;
          response.data = importProgress;
          break;
        }

        // DDL Generation
        case 'GENERATE_DDL': {
          const { connectionId, tableDefinition } = message.payload as {
            connectionId: string;
            tableDefinition: TableDefinition;
          };
          const ddlAdapter = this.getConnectedAdapter(connectionId);
          const ddlDbType = ddlAdapter.getDatabaseType() as DatabaseType;
          const ddl = this.ddlGenerator.generateCreateTable(tableDefinition, ddlDbType);
          response.success = true;
          response.data = ddl;
          break;
        }

        case 'EXECUTE_DDL': {
          const { connectionId, tableDefinition } = message.payload as {
            connectionId: string;
            tableDefinition: TableDefinition;
          };
          const execDdlAdapter = this.getConnectedAdapter(connectionId);
          const execDdlDbType = execDdlAdapter.getDatabaseType() as DatabaseType;
          const execDdl = this.ddlGenerator.generateCreateTable(tableDefinition, execDdlDbType);
          const execDdlResult = await execDdlAdapter.executeQuery(execDdl);
          response.success = !execDdlResult.error;
          response.data = execDdlResult;
          response.error = execDdlResult.error;
          break;
        }

        // Schema Comparison
        case 'COMPARE_SCHEMAS': {
          const { sourceConnectionId, targetConnectionId } = message.payload as {
            sourceConnectionId: string;
            targetConnectionId: string;
          };
          const sourceAdapter = this.getConnectedAdapter(sourceConnectionId);
          const targetAdapter = this.getConnectedAdapter(targetConnectionId);
          const compResult = await this.schemaComparisonService.compare(sourceAdapter, targetAdapter);
          response.success = true;
          response.data = compResult;
          break;
        }

        // Mock Data Generation
        case 'GENERATE_MOCK_DATA': {
          const { connectionId, table, rowCount, columnOverrides } = message.payload as {
            connectionId: string;
            table: string;
            rowCount: number;
            columnOverrides?: Record<string, string>;
          };
          const mockAdapter = this.getConnectedAdapter(connectionId);
          const mockColumns = await mockAdapter.getColumns(table);
          const mockResult = await this.mockDataService.generateAndInsert(
            mockAdapter, table, mockColumns, { rowCount, columnOverrides }
          );
          response.success = true;
          response.data = mockResult;
          break;
        }

        // Monitoring Stats
        case 'GET_MONITORING_STATS': {
          const { connectionId } = message.payload as { connectionId: string };
          const monAdapter = this.getConnectedAdapter(connectionId);
          const monDbType = monAdapter.getDatabaseType() as DatabaseType;
          const stats = await this.monitoringService.getStats(monAdapter, monDbType);
          response.success = true;
          response.data = stats;
          break;
        }

        // Backup
        case 'BACKUP_DATABASE': {
          const { connectionId, outputPath, options } = message.payload as {
            connectionId: string;
            outputPath: string;
            options?: Record<string, unknown>;
          };
          const backupAdapter = this.getConnectedAdapter(connectionId);
          const backupDbType = backupAdapter.getDatabaseType() as DatabaseType;
          const backupResult = await this.backupRestoreService.backup(backupAdapter, backupDbType, outputPath, options);
          response.success = true;
          response.data = backupResult;
          break;
        }

        // Restore
        case 'RESTORE_DATABASE': {
          const { connectionId, outputPath } = message.payload as {
            connectionId: string;
            outputPath: string;
          };
          const restoreAdapter = this.getConnectedAdapter(connectionId);
          const restoreDbType = restoreAdapter.getDatabaseType() as DatabaseType;
          const restoreResult = await this.backupRestoreService.restore(restoreAdapter, restoreDbType, outputPath);
          response.success = true;
          response.data = restoreResult;
          break;
        }

        // Global Search
        case 'GLOBAL_SEARCH': {
          const { query } = message.payload as { query: string };
          if (!this.globalSearchService) {
            response.error = 'Search service not available';
            break;
          }
          const searchResults = await this.globalSearchService.search(query);
          response.success = true;
          response.data = searchResults;
          break;
        }

        default:
          response.error = `Unknown message type: ${message.type}`;
      }
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }

    return response;
  }

  private getConnectedAdapter(connectionId: string): IDatabaseAdapter {
    const adapter = AdapterFactory.get(connectionId);
    if (!adapter?.isConnected()) {
      throw new Error('Not connected to database');
    }
    return adapter;
  }
}
