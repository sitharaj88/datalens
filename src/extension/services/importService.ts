import * as fs from 'fs';
import { parse as csvParse } from 'csv-parse';
import type { IDatabaseAdapter } from '../database/interfaces/IAdapter';

export interface ImportOptions {
  format: 'csv' | 'json';
  tableName: string;
  columnMapping?: Record<string, string>; // source -> target
  batchSize?: number;
  skipErrors?: boolean;
  hasHeaders?: boolean;
}

export interface ImportProgress {
  total: number;
  processed: number;
  errors: number;
  errorMessages: string[];
}

export class ImportService {
  async importFile(
    filePath: string,
    adapter: IDatabaseAdapter,
    options: ImportOptions,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportProgress> {
    const content = fs.readFileSync(filePath, 'utf-8');

    let rows: Record<string, unknown>[];

    if (options.format === 'json') {
      rows = this.parseJSON(content);
    } else {
      rows = await this.parseCSV(content, options.hasHeaders !== false);
    }

    return this.insertRows(rows, adapter, options, onProgress);
  }

  async importData(
    data: string,
    adapter: IDatabaseAdapter,
    options: ImportOptions,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportProgress> {
    let rows: Record<string, unknown>[];

    if (options.format === 'json') {
      rows = this.parseJSON(data);
    } else {
      rows = await this.parseCSV(data, options.hasHeaders !== false);
    }

    return this.insertRows(rows, adapter, options, onProgress);
  }

  private parseJSON(content: string): Record<string, unknown>[] {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object' && parsed !== null) return [parsed];
    throw new Error('JSON must be an array or object');
  }

  private parseCSV(content: string, hasHeaders: boolean): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const rows: Record<string, unknown>[] = [];
      const parser = csvParse({
        columns: hasHeaders,
        skip_empty_lines: true,
        trim: true,
        cast: true,
      });

      parser.on('readable', () => {
        let record;
        while ((record = parser.read()) !== null) {
          rows.push(record as Record<string, unknown>);
        }
      });

      parser.on('error', reject);
      parser.on('end', () => resolve(rows));

      parser.write(content);
      parser.end();
    });
  }

  private async insertRows(
    rows: Record<string, unknown>[],
    adapter: IDatabaseAdapter,
    options: ImportOptions,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportProgress> {
    const batchSize = options.batchSize || 100;
    const progress: ImportProgress = {
      total: rows.length,
      processed: 0,
      errors: 0,
      errorMessages: [],
    };

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      for (const row of batch) {
        try {
          // Apply column mapping if provided
          let mappedRow = row;
          if (options.columnMapping) {
            mappedRow = {};
            for (const [source, target] of Object.entries(options.columnMapping)) {
              if (row[source] !== undefined) {
                mappedRow[target] = row[source];
              }
            }
          }

          await adapter.insertRow(options.tableName, mappedRow);
          progress.processed++;
        } catch (error) {
          progress.errors++;
          const msg = error instanceof Error ? error.message : String(error);
          if (progress.errorMessages.length < 10) {
            progress.errorMessages.push(`Row ${i + progress.processed + 1}: ${msg}`);
          }
          if (!options.skipErrors) {
            throw error;
          }
          progress.processed++;
        }
      }

      onProgress?.(progress);
    }

    return progress;
  }

  preview(content: string, format: 'csv' | 'json', maxRows: number = 10): Record<string, unknown>[] {
    if (format === 'json') {
      const rows = this.parseJSON(content);
      return rows.slice(0, maxRows);
    }
    // Synchronous CSV preview using simple line parsing
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    const headers = this.parseCSVLine(lines[0]);
    const rows: Record<string, unknown>[] = [];

    for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
      const values = this.parseCSVLine(lines[i]);
      const row: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        const val = values[j] ?? '';
        // Auto-cast numbers and booleans
        if (val === '') row[headers[j]] = null;
        else if (!isNaN(Number(val)) && val.trim() !== '') row[headers[j]] = Number(val);
        else if (val.toLowerCase() === 'true') row[headers[j]] = true;
        else if (val.toLowerCase() === 'false') row[headers[j]] = false;
        else row[headers[j]] = val;
      }
      rows.push(row);
    }

    return rows;
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current.trim());
    return result;
  }
}
