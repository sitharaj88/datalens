# Changelog

All notable changes to the DataLens extension will be documented in this file.

## [1.0.0] - 2026-02-07

### Added
- Initial release with support for 15 database types
- **Databases**: SQLite, PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, CockroachDB, MongoDB, Redis, Cassandra, Neo4j, ClickHouse, DynamoDB, Elasticsearch, Firestore
- Connection management with groups, auto-discovery from .env files, and URI parsing
- SSH tunnel support for remote database connections
- SSL/TLS support with certificate configuration
- Schema browser with tree view (tables, views, columns, indexes, foreign keys)
- Query editor with Monaco (syntax highlighting, autocomplete, formatting)
- Schema-aware autocomplete with real table and column names
- Multi-statement execution (run at cursor or run all)
- SQL snippet picker with common query templates
- Results panel with sortable, filterable data grid
- Column visibility toggles and per-column type-aware filtering
- Row detail expansion and inline cell editing
- Context menu (Copy Value, Copy Row as JSON, Copy as INSERT)
- Virtual scrolling for large result sets
- Data export to CSV, JSON, SQL, Markdown, Excel
- Data import from CSV with preview mode
- Chart visualization: Bar, Line, Pie, Area, Scatter, Donut
- Multi-series Y axis and data aggregation (Group By + SUM/AVG/COUNT/MIN/MAX)
- Chart export as SVG
- Query plan visualization with cost-colored tree nodes
- Insert, update, and delete rows through the UI
- Type-aware form controls (boolean toggle, date picker, JSON editor, textarea)
- Transaction support with commit/rollback and isolation level selection
- AI-powered natural language to SQL (OpenAI, Anthropic, Ollama)
- Query optimization suggestions via AI
- Light, dark, and system theme support
- SQL lint panel with inline warnings
- Mock data generation based on column types
- Database monitoring dashboard (connections, size, cache stats)
- Schema comparison between connections
- Backup and restore via SQL dump
- DDL generation
- Data masking for sensitive columns
- Global search across all connected databases
- Tab management with keyboard navigation, duplicate, drag reorder
- Welcome panel with recent connections and queries
