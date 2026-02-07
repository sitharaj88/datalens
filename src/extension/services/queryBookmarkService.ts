import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  connectionId?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export class QueryBookmarkService {
  private static readonly STORAGE_KEY = 'dbViewer.savedQueries';

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private context: vscode.ExtensionContext) {}

  getAll(): SavedQuery[] {
    return this.context.globalState.get<SavedQuery[]>(QueryBookmarkService.STORAGE_KEY, []);
  }

  getById(id: string): SavedQuery | undefined {
    return this.getAll().find(q => q.id === id);
  }

  getByConnection(connectionId: string): SavedQuery[] {
    return this.getAll().filter(q => q.connectionId === connectionId || !q.connectionId);
  }

  getByTag(tag: string): SavedQuery[] {
    return this.getAll().filter(q => q.tags.includes(tag));
  }

  search(term: string): SavedQuery[] {
    const lower = term.toLowerCase();
    return this.getAll().filter(q =>
      q.name.toLowerCase().includes(lower) ||
      q.query.toLowerCase().includes(lower) ||
      q.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  getAllTags(): string[] {
    const tagSet = new Set<string>();
    for (const query of this.getAll()) {
      for (const tag of query.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }

  async save(query: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedQuery> {
    const savedQuery: SavedQuery = {
      ...query,
      id: uuidv4(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const queries = this.getAll();
    queries.push(savedQuery);
    await this.context.globalState.update(QueryBookmarkService.STORAGE_KEY, queries);
    this._onDidChange.fire();
    return savedQuery;
  }

  async update(id: string, updates: Partial<Omit<SavedQuery, 'id' | 'createdAt'>>): Promise<SavedQuery | undefined> {
    const queries = this.getAll();
    const index = queries.findIndex(q => q.id === id);
    if (index === -1) return undefined;

    queries[index] = {
      ...queries[index],
      ...updates,
      updatedAt: Date.now(),
    };

    await this.context.globalState.update(QueryBookmarkService.STORAGE_KEY, queries);
    this._onDidChange.fire();
    return queries[index];
  }

  async delete(id: string): Promise<boolean> {
    const queries = this.getAll();
    const filtered = queries.filter(q => q.id !== id);
    if (filtered.length === queries.length) return false;

    await this.context.globalState.update(QueryBookmarkService.STORAGE_KEY, filtered);
    this._onDidChange.fire();
    return true;
  }

  async importQueries(queries: SavedQuery[]): Promise<number> {
    const existing = this.getAll();
    const existingIds = new Set(existing.map(q => q.id));
    const newQueries = queries.filter(q => !existingIds.has(q.id));

    await this.context.globalState.update(
      QueryBookmarkService.STORAGE_KEY,
      [...existing, ...newQueries]
    );
    this._onDidChange.fire();
    return newQueries.length;
  }

  exportQueries(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }
}
