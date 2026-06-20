# Edit data with guardrails

DataLens lets you change data directly:

- **Inline cell editing** — double-click a cell, edit, press Enter to save.
- **Row operations** — insert, update, and delete rows from the grid with
  type-aware controls (date pickers, boolean toggles, JSON editors).
- **Transactions** — wrap changes in BEGIN/COMMIT/ROLLBACK with an isolation
  level selector.

## Safety first

Before running a destructive statement, DataLens asks you to confirm:

| Operation | What happens |
|-----------|--------------|
| `DELETE` / `UPDATE` **with** a WHERE clause | Quick confirmation |
| `DROP`, `TRUNCATE`, or `DELETE`/`UPDATE` **without** WHERE | Typed confirmation required |
| Any destructive op on a **production** connection | Type `RUN ON PRODUCTION` to proceed |

You can tune this with the **`dbViewer.guardDestructiveQueries`** setting.
