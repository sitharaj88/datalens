# Add a database connection

DataLens connects to **15+ databases** — PostgreSQL, MySQL, MariaDB, SQL Server,
Oracle, CockroachDB, SQLite, MongoDB, Redis, Cassandra, Neo4j, ClickHouse,
DynamoDB, Elasticsearch, and Firestore.

Three ways to add a connection:

1. **Form** — run **DataLens: Add Connection** and fill in host, port, database,
   and credentials.
2. **Connection URI** — run **DataLens: Add Connection from URI** and paste a
   string like `postgresql://user:pass@localhost:5432/mydb`.
3. **Auto-discovery** — DataLens scans your workspace `.env` files for
   `DATABASE_URL`, `MONGO_URI`, `REDIS_URL`, and similar, and offers to add them.

When adding a connection you'll choose its **environment** (development, staging,
or production). Production connections get stricter safety guardrails.

> Tip: Need a secure path to a remote database? Toggle **SSH tunnel** during
> setup — DataLens forwards the connection over SSH for you.
