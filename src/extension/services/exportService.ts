import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import type { IQueryResult, IColumn } from '../../shared/types/database';

export type ExportFormat = 'csv' | 'json' | 'excel';

export interface ExportOptions {
  format: ExportFormat;
  filename?: string;
  includeHeaders?: boolean;
  delimiter?: string;
}

export class ExportService {
  async exportData(
    result: IQueryResult,
    options: ExportOptions
  ): Promise<string | undefined> {
    const defaultFilename = `export_${Date.now()}`;
    const filename = options.filename || defaultFilename;

    const filters: Record<string, string[]> = {
      csv: { 'CSV Files': ['csv'] },
      json: { 'JSON Files': ['json'] },
      excel: { 'Excel Files': ['xlsx'] }
    }[options.format] as Record<string, string[]>;

    const extension = { csv: 'csv', json: 'json', excel: 'xlsx' }[options.format];

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${filename}.${extension}`),
      filters
    });

    if (!saveUri) {
      return undefined;
    }

    try {
      let content: string | Buffer;

      switch (options.format) {
        case 'csv':
          content = this.toCSV(result, options);
          break;
        case 'json':
          content = this.toJSON(result);
          break;
        case 'excel':
          content = this.toExcel(result);
          break;
        default:
          throw new Error(`Unsupported format: ${options.format}`);
      }

      if (typeof content === 'string') {
        fs.writeFileSync(saveUri.fsPath, content, 'utf-8');
      } else {
        fs.writeFileSync(saveUri.fsPath, content);
      }

      vscode.window.showInformationMessage(`Data exported to ${saveUri.fsPath}`);
      return saveUri.fsPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Export failed: ${message}`);
      throw error;
    }
  }

  private toCSV(result: IQueryResult, options: ExportOptions): string {
    const delimiter = options.delimiter || ',';
    const includeHeaders = options.includeHeaders !== false;
    const lines: string[] = [];

    if (includeHeaders && result.columns.length > 0) {
      const headers = result.columns.map(col => this.escapeCSVField(col.name, delimiter));
      lines.push(headers.join(delimiter));
    }

    for (const row of result.rows) {
      const values = result.columns.map(col => {
        const value = row[col.name];
        return this.escapeCSVField(this.formatValue(value), delimiter);
      });
      lines.push(values.join(delimiter));
    }

    return lines.join('\n');
  }

  private toJSON(result: IQueryResult): string {
    const data = result.rows.map(row => {
      const obj: Record<string, unknown> = {};
      for (const col of result.columns) {
        obj[col.name] = row[col.name];
      }
      return obj;
    });

    return JSON.stringify(data, null, 2);
  }

  private toExcel(result: IQueryResult): Buffer {
    const data: unknown[][] = [];

    data.push(result.columns.map(col => col.name));

    for (const row of result.rows) {
      const values = result.columns.map(col => {
        const value = row[col.name];
        if (value === null || value === undefined) {
          return '';
        }
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return value;
      });
      data.push(values);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);

    const colWidths = result.columns.map((col, index) => {
      const headerWidth = col.name.length;
      let maxWidth = headerWidth;

      for (const row of result.rows) {
        const value = row[col.name];
        const valueWidth = this.formatValue(value).length;
        maxWidth = Math.max(maxWidth, Math.min(valueWidth, 50));
      }

      return { wch: maxWidth + 2 };
    });

    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  private escapeCSVField(value: string, delimiter: string): string {
    const needsQuoting = value.includes(delimiter) ||
                         value.includes('"') ||
                         value.includes('\n') ||
                         value.includes('\r');

    if (needsQuoting) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  private formatValue(value: unknown): string {
    if (value === null) return 'NULL';
    if (value === undefined) return '';
    if (typeof value === 'object') {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return JSON.stringify(value);
    }
    return String(value);
  }

  async quickExport(
    result: IQueryResult,
    format: ExportFormat,
    tableName?: string
  ): Promise<string | undefined> {
    const filename = tableName
      ? `${tableName}_${new Date().toISOString().slice(0, 10)}`
      : `query_result_${Date.now()}`;

    return this.exportData(result, { format, filename });
  }
}

export const exportService = new ExportService();
