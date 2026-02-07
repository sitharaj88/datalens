# DataLens - Database Viewer Pro

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/sitharaj.datalens-db-viewer)](https://marketplace.visualstudio.com/items?itemName=sitharaj.datalens-db-viewer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/sitharaj88)

A powerful, all-in-one database client for Visual Studio Code. Browse schemas, execute queries, edit data, visualize charts, and manage 15+ databases — all without leaving your editor.

## Supported Databases (15)

| Database | Status | Driver |
|----------|--------|--------|
| SQLite | Full support | sql.js (WASM) |
| PostgreSQL | Full support | pg |
| MySQL | Full support | mysql2 |
| MariaDB | Full support | mysql2 |
| SQL Server | Full support | tedious |
| Oracle | Full support | oracledb |
| CockroachDB | Full support | pg |
| MongoDB | Full support | mongodb |
| Redis | Full support | ioredis |
| Cassandra | Full support | cassandra-driver |
| Neo4j | Full support | neo4j-driver |
| ClickHouse | Full support | @clickhouse/client |
| DynamoDB | Full support | @aws-sdk |
| Elasticsearch | Full support | @elastic/elasticsearch |
| Firestore | Full support | firebase-admin |

## Features

### Connection Management
- Add connections via form or connection URI
- Auto-discover connections from `.env` files in your workspace
- Organize connections into groups
- SSH tunnel support for remote databases
- SSL/TLS support with certificate configuration
- Connection pooling with configurable limits

### Schema Browser
- Tree view in the sidebar showing databases, tables, views, columns, indexes
- Foreign key relationships displayed inline
- Stored procedures, triggers, and views
- Schema comparison between two connections
- Copy table names and generate SELECT/INSERT templates from context menu

### Query Editor
- Full SQL editor powered by Monaco (same editor as VS Code)
- Schema-aware autocomplete with table and column names
- SQL formatting and syntax highlighting
- Multi-statement execution (run statement at cursor or all)
- Snippet picker with common query templates
- Query history with one-click re-run
- SQL lint warnings displayed inline

### Results Panel
- Sortable, filterable data grid with pagination
- Column visibility toggles
- Per-column type-aware filtering (text, number, date, boolean)
- Row detail expansion for inspecting long values
- Inline cell editing with Enter to save
- Context menu: Copy Value, Copy Row as JSON, Copy as INSERT
- Virtual scrolling for large result sets

### Data Export & Import
- Export to CSV, JSON, SQL INSERT statements, Markdown, Excel
- Import from CSV with preview mode
- Configurable delimiters and encoding

### Visualization
- Built-in chart panel: Bar, Line, Pie, Area, Scatter, Donut
- Multi-series Y axis support
- Data aggregation toolbar (Group By + SUM/AVG/COUNT/MIN/MAX)
- Export charts as SVG
- Query plan visualization with cost-colored tree nodes

### Data Editing
- Insert, update, and delete rows through the UI
- Type-aware form controls (boolean toggle, date picker, JSON editor, textarea)
- Transaction support with commit/rollback controls
- Isolation level selector
- Long-running transaction warnings

### AI-Powered Features
- Natural language to SQL conversion
- Query optimization suggestions
- Supports OpenAI, Anthropic, and Ollama providers

### Additional Features
- Light, dark, and system theme support
- ERD (Entity Relationship Diagram) visualization
- Mock data generation based on column types
- Database monitoring (connections, size, cache stats)
- Backup and restore (SQL dump)
- DDL generation
- Data masking for sensitive columns
- Global search across all connected databases
- Keyboard shortcuts throughout

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open the **DataLens** panel from the Activity Bar (database icon)
3. Click the **+** button to add a connection
4. Select your database type, enter credentials, and connect
5. Browse your schema, click a table to view data, or open a new query tab

### Quick Connect via URI

Use the **DataLens: Add Connection from URI** command to paste a connection string:

```
postgresql://user:pass@localhost:5432/mydb
mysql://user:pass@localhost:3306/mydb
mongodb://user:pass@localhost:27017/mydb
redis://localhost:6379
```

### Auto-Discovery

DataLens automatically scans `.env` files in your workspace for database connection strings (`DATABASE_URL`, `MONGO_URI`, `REDIS_URL`, etc.) and offers to add them as connections.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` / `Cmd+Enter` | Execute query at cursor |
| `Ctrl+Shift+Enter` | Execute all statements |
| `Ctrl+S` / `Cmd+S` | Save query |
| `Ctrl+Tab` | Cycle through tabs |
| `Ctrl+1` - `Ctrl+9` | Jump to tab by number |
| `Escape` | Cancel inline edit |

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dbViewer.maxRows` | 1000 | Maximum rows to fetch per query |
| `dbViewer.queryTimeout` | 30000 | Query timeout in milliseconds |
| `dbViewer.confirmDelete` | true | Confirm before deleting rows |
| `dbViewer.autoDiscover` | true | Auto-discover connections from .env |
| `dbViewer.ai.provider` | openai | AI provider (openai, anthropic, ollama) |
| `dbViewer.ai.apiKey` | | API key for AI features |
| `dbViewer.ai.model` | | Model name for AI features |
| `dbViewer.dataMasking.enabled` | false | Enable sensitive data masking |
| `dbViewer.schemaCacheTTL` | 60000 | Schema cache duration (ms) |

## Requirements

- VS Code 1.85.0 or later
- Database-specific drivers are bundled with the extension (no additional installation needed for SQLite, PostgreSQL, MySQL, MariaDB, SQL Server, MongoDB, Redis, etc.)
- Oracle requires the Oracle Instant Client installed on your system
- DynamoDB requires AWS credentials configured
- Firestore requires a Firebase service account key

## Support

If you find DataLens useful, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/sitharaj88)

## Contributing

Contributions are welcome! Please open an [issue](https://github.com/sitharaj88/datalens/issues) or submit a [pull request](https://github.com/sitharaj88/datalens/pulls).

## License

[MIT](LICENSE) - Copyright (c) 2026 Sitharaj Seenivasan
