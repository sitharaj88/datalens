# Generate SQL with AI

Describe what you want in plain English and let DataLens write the query against
your actual schema.

1. Open the **Ask AI** bar in a query tab.
2. Type something like *"top 10 customers by total order value this year"*.
3. Review the generated SQL, then run it.

DataLens also suggests **query optimizations** for slow statements.

## Choose your provider

Set these in **Settings → DataLens → AI**:

- **`dbViewer.ai.provider`** — `openai`, `anthropic`, or `ollama`
- **`dbViewer.ai.apiKey`** — your API key (not needed for local Ollama)
- **`dbViewer.ai.model`** — e.g. `gpt-4`, `claude-sonnet-4-5-20250929`, or a
  local model name

> Prefer to keep data on your machine? Point DataLens at a local **Ollama**
> model — no data leaves your computer.
