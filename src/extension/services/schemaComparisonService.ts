import type { IDatabaseAdapter } from '../database/interfaces/IAdapter';

export interface SchemaDifference {
  type: 'table_missing' | 'table_extra' | 'column_missing' | 'column_extra'
      | 'column_type_mismatch' | 'index_missing' | 'index_extra';
  source: 'left' | 'right';
  objectName: string;
  tableName?: string;
  details: string;
}

export interface SchemaComparisonResult {
  differences: SchemaDifference[];
  summary: {
    tablesOnlyInSource: number;
    tablesOnlyInTarget: number;
    tablesWithDifferences: number;
    totalDifferences: number;
  };
}

export class SchemaComparisonService {
  async compare(
    sourceAdapter: IDatabaseAdapter,
    targetAdapter: IDatabaseAdapter,
  ): Promise<SchemaComparisonResult> {
    const differences: SchemaDifference[] = [];

    const sourceTables = await sourceAdapter.getTables();
    const targetTables = await targetAdapter.getTables();

    const sourceNames = new Set(sourceTables.map(t => t.name));
    const targetNames = new Set(targetTables.map(t => t.name));

    let tablesOnlyInSource = 0;
    let tablesOnlyInTarget = 0;
    let tablesWithDifferences = 0;

    // Tables only in source
    for (const name of sourceNames) {
      if (!targetNames.has(name)) {
        tablesOnlyInSource++;
        differences.push({
          type: 'table_missing',
          source: 'right',
          objectName: name,
          details: `Table "${name}" exists in source but not in target`,
        });
      }
    }

    // Tables only in target
    for (const name of targetNames) {
      if (!sourceNames.has(name)) {
        tablesOnlyInTarget++;
        differences.push({
          type: 'table_extra',
          source: 'right',
          objectName: name,
          details: `Table "${name}" exists in target but not in source`,
        });
      }
    }

    // Compare common tables
    for (const name of sourceNames) {
      if (!targetNames.has(name)) continue;

      const [sourceCols, targetCols] = await Promise.all([
        sourceAdapter.getColumns(name),
        targetAdapter.getColumns(name),
      ]);

      const sourceColMap = new Map(sourceCols.map(c => [c.name, c]));
      const targetColMap = new Map(targetCols.map(c => [c.name, c]));
      let hasDiffs = false;

      for (const [colName, col] of sourceColMap) {
        if (!targetColMap.has(colName)) {
          hasDiffs = true;
          differences.push({
            type: 'column_missing',
            source: 'right',
            objectName: colName,
            tableName: name,
            details: `Column "${colName}" (${col.type}) missing in target table "${name}"`,
          });
        } else {
          const targetCol = targetColMap.get(colName)!;
          if (col.type.toLowerCase() !== targetCol.type.toLowerCase()) {
            hasDiffs = true;
            differences.push({
              type: 'column_type_mismatch',
              source: 'left',
              objectName: colName,
              tableName: name,
              details: `Column "${colName}" in "${name}": source type "${col.type}" vs target type "${targetCol.type}"`,
            });
          }
        }
      }

      for (const [colName, col] of targetColMap) {
        if (!sourceColMap.has(colName)) {
          hasDiffs = true;
          differences.push({
            type: 'column_extra',
            source: 'right',
            objectName: colName,
            tableName: name,
            details: `Column "${colName}" (${col.type}) exists in target but not in source for table "${name}"`,
          });
        }
      }

      if (hasDiffs) tablesWithDifferences++;
    }

    return {
      differences,
      summary: {
        tablesOnlyInSource,
        tablesOnlyInTarget,
        tablesWithDifferences,
        totalDifferences: differences.length,
      },
    };
  }
}
