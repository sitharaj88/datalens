import type { DatabaseType } from '../../shared/types/database';

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  indexes?: IndexDefinition[];
  foreignKeys?: ForeignKeyDefinition[];
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  defaultValue?: string;
  unique?: boolean;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface ForeignKeyDefinition {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface AlterTableChange {
  type: 'addColumn' | 'dropColumn' | 'renameColumn' | 'modifyColumn' | 'addIndex' | 'dropIndex';
  column?: ColumnDefinition;
  columnName?: string;
  newColumnName?: string;
  index?: IndexDefinition;
  indexName?: string;
}

export class DDLGenerator {
  generateCreateTable(definition: TableDefinition, dbType: DatabaseType): string {
    const lines: string[] = [];
    const constraints: string[] = [];

    lines.push(`CREATE TABLE "${definition.name}" (`);

    // Columns
    const colDefs: string[] = [];
    const pkColumns: string[] = [];

    for (const col of definition.columns) {
      let def = `  "${col.name}" ${this.mapType(col.type, dbType)}`;

      if (col.primaryKey) {
        pkColumns.push(col.name);
        if (col.autoIncrement) {
          def = this.addAutoIncrement(def, col, dbType);
        }
      }

      if (!col.nullable && !col.primaryKey) {
        def += ' NOT NULL';
      }

      if (col.defaultValue !== undefined) {
        def += ` DEFAULT ${col.defaultValue}`;
      }

      if (col.unique && !col.primaryKey) {
        def += ' UNIQUE';
      }

      colDefs.push(def);
    }

    lines.push(colDefs.join(',\n'));

    // Primary key constraint
    if (pkColumns.length > 0) {
      constraints.push(`  PRIMARY KEY ("${pkColumns.join('", "')}")`);
    }

    // Foreign keys
    if (definition.foreignKeys) {
      for (const fk of definition.foreignKeys) {
        let fkDef = `  CONSTRAINT "${fk.name}" FOREIGN KEY ("${fk.columns.join('", "')}") REFERENCES "${fk.referencedTable}" ("${fk.referencedColumns.join('", "')}")`;
        if (fk.onDelete) fkDef += ` ON DELETE ${fk.onDelete}`;
        if (fk.onUpdate) fkDef += ` ON UPDATE ${fk.onUpdate}`;
        constraints.push(fkDef);
      }
    }

    if (constraints.length > 0) {
      lines[lines.length - 1] += ',';
      lines.push(constraints.join(',\n'));
    }

    lines.push(');');

    // Indexes
    if (definition.indexes) {
      for (const idx of definition.indexes) {
        const unique = idx.unique ? 'UNIQUE ' : '';
        lines.push(`\nCREATE ${unique}INDEX "${idx.name}" ON "${definition.name}" ("${idx.columns.join('", "')}");`);
      }
    }

    return lines.join('\n');
  }

  generateAlterTable(tableName: string, changes: AlterTableChange[], dbType: DatabaseType): string {
    const statements: string[] = [];

    for (const change of changes) {
      switch (change.type) {
        case 'addColumn': {
          const col = change.column!;
          let def = `ALTER TABLE "${tableName}" ADD COLUMN "${col.name}" ${this.mapType(col.type, dbType)}`;
          if (!col.nullable) def += ' NOT NULL';
          if (col.defaultValue !== undefined) def += ` DEFAULT ${col.defaultValue}`;
          statements.push(def + ';');
          break;
        }
        case 'dropColumn':
          statements.push(`ALTER TABLE "${tableName}" DROP COLUMN "${change.columnName}";`);
          break;
        case 'renameColumn':
          if (dbType === 'postgresql' || dbType === 'mysql' || dbType === 'mariadb') {
            statements.push(`ALTER TABLE "${tableName}" RENAME COLUMN "${change.columnName}" TO "${change.newColumnName}";`);
          }
          break;
        case 'modifyColumn': {
          const col = change.column!;
          if (dbType === 'postgresql') {
            statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE ${this.mapType(col.type, dbType)};`);
            if (col.nullable === false) {
              statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" SET NOT NULL;`);
            } else if (col.nullable === true) {
              statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" DROP NOT NULL;`);
            }
          } else {
            let def = `ALTER TABLE "${tableName}" MODIFY COLUMN "${col.name}" ${this.mapType(col.type, dbType)}`;
            if (!col.nullable) def += ' NOT NULL';
            statements.push(def + ';');
          }
          break;
        }
        case 'addIndex': {
          const idx = change.index!;
          const unique = idx.unique ? 'UNIQUE ' : '';
          statements.push(`CREATE ${unique}INDEX "${idx.name}" ON "${tableName}" ("${idx.columns.join('", "')}");`);
          break;
        }
        case 'dropIndex':
          statements.push(`DROP INDEX "${change.indexName}";`);
          break;
      }
    }

    return statements.join('\n');
  }

  private mapType(type: string, _dbType: DatabaseType): string {
    // Pass through - types are already DB-specific in most cases
    return type;
  }

  private addAutoIncrement(def: string, col: ColumnDefinition, dbType: DatabaseType): string {
    switch (dbType) {
      case 'postgresql':
      case 'cockroachdb':
        return `  "${col.name}" SERIAL`;
      case 'mysql':
      case 'mariadb':
        return def + ' AUTO_INCREMENT';
      case 'sqlite':
        return `  "${col.name}" INTEGER PRIMARY KEY AUTOINCREMENT`;
      case 'mssql':
        return def + ' IDENTITY(1,1)';
      default:
        return def;
    }
  }
}
