import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { DatabaseCapabilities } from '../types';

interface Snippet {
  id: string;
  name: string;
  query: string;
  category: string;
}

interface DropdownPosition {
  top: number;
  right: number;
}

const BUILT_IN_SNIPPETS: Snippet[] = [
  { id: 'select-all', name: 'Select All', query: 'SELECT * FROM ${table} LIMIT 100;', category: 'Basic' },
  { id: 'select-count', name: 'Count Rows', query: 'SELECT COUNT(*) as total FROM ${table};', category: 'Basic' },
  { id: 'select-distinct', name: 'Distinct Values', query: 'SELECT DISTINCT ${column} FROM ${table} ORDER BY ${column};', category: 'Basic' },
  { id: 'select-top', name: 'Top N Rows', query: 'SELECT * FROM ${table} ORDER BY ${column} DESC LIMIT 10;', category: 'Basic' },
  { id: 'group-by', name: 'Group By Count', query: 'SELECT ${column}, COUNT(*) as count\nFROM ${table}\nGROUP BY ${column}\nORDER BY count DESC;', category: 'Aggregation' },
  { id: 'group-sum', name: 'Group By Sum', query: 'SELECT ${group_column}, SUM(${value_column}) as total\nFROM ${table}\nGROUP BY ${group_column}\nORDER BY total DESC;', category: 'Aggregation' },
  { id: 'inner-join', name: 'Inner Join', query: 'SELECT a.*, b.*\nFROM ${table1} a\nINNER JOIN ${table2} b ON a.${key} = b.${key};', category: 'Joins' },
  { id: 'left-join', name: 'Left Join', query: 'SELECT a.*, b.*\nFROM ${table1} a\nLEFT JOIN ${table2} b ON a.${key} = b.${key};', category: 'Joins' },
  { id: 'subquery', name: 'Subquery Filter', query: 'SELECT *\nFROM ${table}\nWHERE ${column} IN (\n  SELECT ${column} FROM ${other_table}\n);', category: 'Advanced' },
  { id: 'cte', name: 'Common Table Expression', query: 'WITH cte AS (\n  SELECT * FROM ${table}\n  WHERE ${condition}\n)\nSELECT * FROM cte;', category: 'Advanced' },
  { id: 'window', name: 'Window Function', query: 'SELECT *,\n  ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${order}) as row_num\nFROM ${table};', category: 'Advanced' },
  { id: 'upsert-pg', name: 'Upsert (PostgreSQL)', query: 'INSERT INTO ${table} (${columns})\nVALUES (${values})\nON CONFLICT (${key}) DO UPDATE\nSET ${column} = EXCLUDED.${column};', category: 'DML' },
  { id: 'create-table', name: 'Create Table', query: 'CREATE TABLE ${table_name} (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(255) NOT NULL,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);', category: 'DDL' },
  { id: 'create-index', name: 'Create Index', query: 'CREATE INDEX idx_${table}_${column}\nON ${table} (${column});', category: 'DDL' },
  { id: 'table-size', name: 'Table Size (PostgreSQL)', query: "SELECT\n  schemaname,\n  tablename,\n  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as total_size\nFROM pg_tables\nWHERE schemaname = 'public'\nORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;", category: 'Admin' },
  { id: 'active-queries', name: 'Active Queries (PostgreSQL)', query: 'SELECT pid, usename, state, query, query_start\nFROM pg_stat_activity\nWHERE state != \'idle\'\nORDER BY query_start;', category: 'Admin' },
];

const MONGODB_SNIPPETS: Snippet[] = [
  { id: 'mongo-find', name: 'Find Documents', query: '{ "find": "${collection}", "filter": {}, "limit": 100 }', category: 'Query' },
  { id: 'mongo-count', name: 'Count Documents', query: '{ "count": "${collection}", "query": {} }', category: 'Query' },
  { id: 'mongo-aggregate', name: 'Aggregate Pipeline', query: '{ "aggregate": "${collection}", "pipeline": [\n  { "$match": {} },\n  { "$group": { "_id": "$${field}", "count": { "$sum": 1 } } },\n  { "$sort": { "count": -1 } }\n], "cursor": {} }', category: 'Aggregation' },
  { id: 'mongo-insert', name: 'Insert Document', query: '{ "insert": "${collection}", "documents": [\n  { "name": "value" }\n] }', category: 'Write' },
  { id: 'mongo-update', name: 'Update Documents', query: '{ "update": "${collection}", "updates": [\n  { "q": { "_id": "" }, "u": { "$set": { "field": "value" } } }\n] }', category: 'Write' },
  { id: 'mongo-delete', name: 'Delete Documents', query: '{ "delete": "${collection}", "deletes": [\n  { "q": { "_id": "" }, "limit": 1 }\n] }', category: 'Write' },
];

const CYPHER_SNIPPETS: Snippet[] = [
  { id: 'cypher-match', name: 'Match Nodes', query: 'MATCH (n:${Label})\nRETURN n\nLIMIT 100', category: 'Query' },
  { id: 'cypher-rel', name: 'Match Relationships', query: 'MATCH (a:${Label1})-[r:${REL_TYPE}]->(b:${Label2})\nRETURN a, r, b\nLIMIT 100', category: 'Query' },
  { id: 'cypher-create', name: 'Create Node', query: 'CREATE (n:${Label} { name: "${value}" })\nRETURN n', category: 'Write' },
  { id: 'cypher-create-rel', name: 'Create Relationship', query: 'MATCH (a:${Label1} { name: "${name1}" })\nMATCH (b:${Label2} { name: "${name2}" })\nCREATE (a)-[:${REL_TYPE}]->(b)', category: 'Write' },
  { id: 'cypher-shortest', name: 'Shortest Path', query: 'MATCH p = shortestPath(\n  (a:${Label} { name: "${start}" })-[*]-(b:${Label} { name: "${end}" })\n)\nRETURN p', category: 'Advanced' },
  { id: 'cypher-count', name: 'Count by Label', query: 'MATCH (n:${Label})\nRETURN count(n) AS total', category: 'Query' },
];

const REDIS_SNIPPETS: Snippet[] = [
  { id: 'redis-get', name: 'GET', query: 'GET ${key}', category: 'String' },
  { id: 'redis-set', name: 'SET', query: 'SET ${key} ${value}', category: 'String' },
  { id: 'redis-hgetall', name: 'HGETALL', query: 'HGETALL ${key}', category: 'Hash' },
  { id: 'redis-hset', name: 'HSET', query: 'HSET ${key} ${field} ${value}', category: 'Hash' },
  { id: 'redis-keys', name: 'KEYS', query: 'KEYS ${pattern}', category: 'General' },
  { id: 'redis-info', name: 'INFO', query: 'INFO', category: 'General' },
  { id: 'redis-lpush', name: 'LPUSH', query: 'LPUSH ${key} ${value}', category: 'List' },
  { id: 'redis-lrange', name: 'LRANGE', query: 'LRANGE ${key} 0 -1', category: 'List' },
  { id: 'redis-smembers', name: 'SMEMBERS', query: 'SMEMBERS ${key}', category: 'Set' },
];

const ELASTICSEARCH_SNIPPETS: Snippet[] = [
  { id: 'es-match-all', name: 'Match All', query: '{\n  "query": { "match_all": {} },\n  "size": 100\n}', category: 'Query' },
  { id: 'es-match', name: 'Match Query', query: '{\n  "query": {\n    "match": { "${field}": "${value}" }\n  }\n}', category: 'Query' },
  { id: 'es-bool', name: 'Bool Query', query: '{\n  "query": {\n    "bool": {\n      "must": [{ "match": { "${field}": "${value}" } }],\n      "filter": [{ "range": { "${date_field}": { "gte": "now-1d" } } }]\n    }\n  }\n}', category: 'Query' },
  { id: 'es-agg', name: 'Aggregation', query: '{\n  "size": 0,\n  "aggs": {\n    "group_by_${field}": {\n      "terms": { "field": "${field}.keyword", "size": 10 }\n    }\n  }\n}', category: 'Aggregation' },
];

const CQL_SNIPPETS: Snippet[] = [
  { id: 'cql-select', name: 'Select All', query: 'SELECT * FROM ${table} LIMIT 100;', category: 'Query' },
  { id: 'cql-insert', name: 'Insert Row', query: 'INSERT INTO ${table} (${columns}) VALUES (${values});', category: 'Write' },
  { id: 'cql-update', name: 'Update Row', query: 'UPDATE ${table} SET ${column} = ${value} WHERE ${key} = ${key_value};', category: 'Write' },
  { id: 'cql-delete', name: 'Delete Row', query: 'DELETE FROM ${table} WHERE ${key} = ${key_value};', category: 'Write' },
  { id: 'cql-describe', name: 'Describe Table', query: 'DESCRIBE TABLE ${table};', category: 'Schema' },
  { id: 'cql-keyspaces', name: 'List Keyspaces', query: 'SELECT * FROM system_schema.keyspaces;', category: 'Schema' },
];

function getSnippetsForCapabilities(capabilities: DatabaseCapabilities | null): Snippet[] {
  if (!capabilities) return BUILT_IN_SNIPPETS;

  switch (capabilities.databaseType) {
    case 'mongodb':
      return MONGODB_SNIPPETS;
    case 'elasticsearch':
      return ELASTICSEARCH_SNIPPETS;
    case 'neo4j':
      return CYPHER_SNIPPETS;
    case 'redis':
      return REDIS_SNIPPETS;
    case 'cassandra':
      return CQL_SNIPPETS;
    default:
      return BUILT_IN_SNIPPETS;
  }
}

interface SnippetPickerProps {
  onSelect: (query: string) => void;
  capabilities: DatabaseCapabilities | null;
}

export function SnippetPicker({ onSelect, capabilities }: SnippetPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition>({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const snippets = useMemo(() => getSnippetsForCapabilities(capabilities), [capabilities]);

  const filtered = snippets.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.category.toLowerCase().includes(search.toLowerCase())
  );

  const categories = [...new Set(filtered.map(s => s.category))];

  const handleSelect = (snippet: Snippet) => {
    onSelect(snippet.query);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => {
          if (!isOpen) updatePosition();
          setIsOpen(!isOpen);
        }}
        title="Code Snippets"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </button>

      {isOpen && (
        <div ref={ref} className="snippet-dropdown" style={{ top: dropdownPos.top, right: dropdownPos.right }}>
          <div className="snippet-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search snippets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="snippet-list">
            {categories.map(category => (
              <div key={category}>
                <div className="snippet-category">{category}</div>
                {filtered
                  .filter(s => s.category === category)
                  .map(snippet => (
                    <button
                      key={snippet.id}
                      className="snippet-item"
                      onClick={() => handleSelect(snippet)}
                    >
                      <span className="snippet-name">{snippet.name}</span>
                      <span className="snippet-preview">{snippet.query.substring(0, 40)}...</span>
                    </button>
                  ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="snippet-empty">No snippets match your search</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
