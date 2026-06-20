# Run your first query

Open a query tab with **DataLens: New Query**, or click a table in the **Schema
Explorer** to view its data instantly.

In the editor:

- **Ctrl/Cmd + Enter** — run the statement at the cursor
- **Ctrl + Shift + Enter** — run all statements
- **Ctrl/Cmd + S** — save the query to your library

The editor is powered by Monaco (the same engine as VS Code) with **schema-aware
autocomplete**: it knows your tables, views, and columns, resolves table
**aliases across JOINs** (`SELECT u.| FROM users u JOIN orders o ...`), and
understands **CTEs** declared in `WITH` clauses.

Results appear in a sortable, filterable grid with pagination and virtual
scrolling — built to stay responsive on large result sets.
