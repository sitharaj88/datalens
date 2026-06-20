import * as vscode from 'vscode';
import type { ISchemaMetadata } from '../../shared/types/database';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIProvider {
  generateSQL(prompt: string, schemaContext: string): Promise<string>;
  suggestOptimizations(query: string, schemaContext: string, explainOutput?: string): Promise<string[]>;
  /** Multi-turn chat completion used by the agentic workflow. */
  chat(messages: ChatMessage[]): Promise<string>;
}

class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4';
  }

  async generateSQL(prompt: string, schemaContext: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a SQL expert. Given a database schema and a natural language question, generate the appropriate SQL query. Only output the SQL query, nothing else.\n\nSchema:\n${schemaContext}`
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const sql = data.choices[0]?.message?.content?.trim() || '';

    // Strip markdown code fences if present
    return sql.replace(/^```sql\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  async suggestOptimizations(query: string, schemaContext: string, explainOutput?: string): Promise<string[]> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a SQL optimization expert. Analyze the query and suggest optimizations. Return each suggestion on a new line, prefixed with "- ".\n\nSchema:\n${schemaContext}${explainOutput ? `\n\nEXPLAIN output:\n${explainOutput}` : ''}`
          },
          { role: 'user', content: `Optimize this query:\n${query}` }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API error');
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices[0]?.message?.content?.trim() || '';
    return text.split('\n').filter((line: string) => line.trim().startsWith('-')).map((line: string) => line.trim().slice(2).trim());
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.1, max_tokens: 1500 }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${await response.text()}`);
    }
    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() || '';
  }
}

class AnthropicProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || 'claude-sonnet-4-5-20250929';
  }

  async generateSQL(prompt: string, schemaContext: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        system: `You are a SQL expert. Given a database schema and a natural language question, generate the appropriate SQL query. Only output the SQL query, nothing else.\n\nSchema:\n${schemaContext}`,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    const sql = data.content[0]?.text?.trim() || '';
    return sql.replace(/^```sql\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  async suggestOptimizations(query: string, schemaContext: string, explainOutput?: string): Promise<string[]> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        system: `You are a SQL optimization expert. Analyze the query and suggest optimizations. Return each suggestion on a new line, prefixed with "- ".\n\nSchema:\n${schemaContext}${explainOutput ? `\n\nEXPLAIN output:\n${explainOutput}` : ''}`,
        messages: [{ role: 'user', content: `Optimize this query:\n${query}` }],
      }),
    });

    if (!response.ok) {
      throw new Error('Anthropic API error');
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    const text = data.content[0]?.text?.trim() || '';
    return text.split('\n').filter((line: string) => line.trim().startsWith('-')).map((line: string) => line.trim().slice(2).trim());
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    // Anthropic takes the system prompt separately and only user/assistant turns in messages.
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const turns = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: this.model, max_tokens: 1500, system, messages: turns }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${await response.text()}`);
    }
    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text?.trim() || '';
  }
}

class OllamaProvider implements AIProvider {
  private baseUrl: string;
  private model: string;

  constructor(model?: string, baseUrl?: string) {
    this.baseUrl = baseUrl || 'http://localhost:11434';
    this.model = model || 'codellama';
  }

  async generateSQL(prompt: string, schemaContext: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `You are a SQL expert. Given this schema:\n${schemaContext}\n\nGenerate a SQL query for: ${prompt}\n\nOnly output the SQL query:`,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error('Ollama API error');
    }

    const data = await response.json() as { response: string };
    const sql = data.response?.trim() || '';
    return sql.replace(/^```sql\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  async suggestOptimizations(query: string, schemaContext: string, explainOutput?: string): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `Analyze and suggest optimizations for this SQL query. Return each suggestion on a new line prefixed with "- ".\n\nSchema:\n${schemaContext}${explainOutput ? `\n\nEXPLAIN:\n${explainOutput}` : ''}\n\nQuery:\n${query}`,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error('Ollama API error');
    }

    const data = await response.json() as { response: string };
    const text = data.response?.trim() || '';
    return text.split('\n').filter((line: string) => line.trim().startsWith('-')).map((line: string) => line.trim().slice(2).trim());
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: false }),
    });
    if (!response.ok) {
      throw new Error('Ollama API error');
    }
    const data = await response.json() as { message?: { content: string } };
    return data.message?.content?.trim() || '';
  }
}

/**
 * Sends a chat conversation to a VS Code Language Model (e.g. a GitHub Copilot
 * model) and returns the concatenated text. Shared by the Copilot provider and
 * the chat participant.
 */
export async function chatWithLmModel(
  model: vscode.LanguageModelChat,
  messages: ChatMessage[],
  token?: vscode.CancellationToken
): Promise<string> {
  const lmMessages = messages.map(m =>
    m.role === 'assistant'
      ? vscode.LanguageModelChatMessage.Assistant(m.content)
      : vscode.LanguageModelChatMessage.User(m.content)
  );
  const cancellation = token ?? new vscode.CancellationTokenSource().token;
  const response = await model.sendRequest(lmMessages, {}, cancellation);
  let text = '';
  for await (const fragment of response.text) {
    text += fragment;
  }
  return text.trim();
}

/**
 * Uses the GitHub Copilot language models already available in VS Code via the
 * Language Model API — no API key required. Requires the user to have Copilot.
 */
class CopilotProvider implements AIProvider {
  constructor(private family?: string) {}

  private async getModel(): Promise<vscode.LanguageModelChat> {
    const selector = this.family ? { vendor: 'copilot', family: this.family } : { vendor: 'copilot' };
    let models = await vscode.lm.selectChatModels(selector);
    if (models.length === 0 && this.family) {
      // Fall back to any Copilot model if the requested family isn't present.
      models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    }
    if (models.length === 0) {
      throw new Error(
        'No GitHub Copilot language models are available. Install and sign in to GitHub Copilot, or choose a different AI provider in Settings > DataLens > AI.'
      );
    }
    return models[0];
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const model = await this.getModel();
    return chatWithLmModel(model, messages);
  }

  async generateSQL(prompt: string, schemaContext: string): Promise<string> {
    const out = await this.chat([
      {
        role: 'user',
        content: `You are a SQL expert. Given this database schema, write a single SQL query for the request. Output ONLY the SQL, no explanation or markdown.\n\nSchema:\n${schemaContext}\n\nRequest: ${prompt}`,
      },
    ]);
    return out.replace(/^```sql\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  async suggestOptimizations(query: string, schemaContext: string, explainOutput?: string): Promise<string[]> {
    const out = await this.chat([
      {
        role: 'user',
        content: `You are a SQL optimization expert. Suggest optimizations for the query. Return each suggestion on its own line prefixed with "- ".\n\nSchema:\n${schemaContext}${explainOutput ? `\n\nEXPLAIN output:\n${explainOutput}` : ''}\n\nQuery:\n${query}`,
      },
    ]);
    return out.split('\n').filter(line => line.trim().startsWith('-')).map(line => line.trim().slice(2).trim());
  }
}

export class AIService {
  private provider: AIProvider | null = null;

  constructor() {
    this.refreshProvider();
  }

  refreshProvider(): void {
    const config = vscode.workspace.getConfiguration('dbViewer.ai');
    const providerName = config.get<string>('provider', 'openai');
    const apiKey = config.get<string>('apiKey', '');
    const model = config.get<string>('model', '');

    switch (providerName) {
      case 'copilot':
        this.provider = new CopilotProvider(model || undefined);
        break;
      case 'openai':
        if (apiKey) {
          this.provider = new OpenAIProvider(apiKey, model || undefined);
        }
        break;
      case 'anthropic':
        if (apiKey) {
          this.provider = new AnthropicProvider(apiKey, model || undefined);
        }
        break;
      case 'ollama':
        this.provider = new OllamaProvider(model || undefined);
        break;
      default:
        this.provider = null;
    }
  }

  isConfigured(): boolean {
    return this.provider !== null;
  }

  formatSchemaContext(metadata: ISchemaMetadata): string {
    const lines: string[] = [];
    for (const table of metadata.tables) {
      const cols = table.columns.map(c => {
        return `  ${c.name} ${c.type}`;
      });
      lines.push(`CREATE TABLE ${table.name} (\n${cols.join(',\n')}\n);`);
    }
    if (metadata.views && metadata.views.length > 0) {
      lines.push(`\n-- Views: ${metadata.views.map(v => v.name).join(', ')}`);
    }
    return lines.join('\n\n');
  }

  async naturalLanguageToSQL(prompt: string, schemaContext: string): Promise<string> {
    if (!this.provider) {
      throw new Error('AI provider not configured. Set up your API key in Settings > Database Viewer > AI.');
    }
    return this.provider.generateSQL(prompt, schemaContext);
  }

  async suggestOptimizations(query: string, schemaContext: string, explainOutput?: string): Promise<string[]> {
    if (!this.provider) {
      throw new Error('AI provider not configured.');
    }
    return this.provider.suggestOptimizations(query, schemaContext, explainOutput);
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.provider) {
      throw new Error('AI provider not configured.');
    }
    return this.provider.chat(messages);
  }
}
