import * as vscode from 'vscode';
import type { QueryBookmarkService, SavedQuery } from '../services/queryBookmarkService';

export class QueryLibraryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly query: SavedQuery | null,
    public readonly isTag: boolean,
    public readonly tagName?: string
  ) {
    super(
      isTag ? tagName! : query!.name,
      isTag
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    if (!isTag && query) {
      this.description = query.query.substring(0, 60).replace(/\n/g, ' ');
      this.tooltip = new vscode.MarkdownString(`**${query.name}**\n\n\`\`\`sql\n${query.query}\n\`\`\`\n\nTags: ${query.tags.join(', ') || 'none'}`);
      this.iconPath = new vscode.ThemeIcon('file-code');
      this.contextValue = 'savedQuery';
      this.command = {
        command: 'dbViewer.openSavedQuery',
        title: 'Open Saved Query',
        arguments: [query]
      };
    } else {
      this.iconPath = new vscode.ThemeIcon('tag');
      this.contextValue = 'queryTag';
    }
  }
}

export class QueryLibraryTreeProvider implements vscode.TreeDataProvider<QueryLibraryTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<QueryLibraryTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private bookmarkService: QueryBookmarkService) {
    bookmarkService.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: QueryLibraryTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: QueryLibraryTreeItem): Promise<QueryLibraryTreeItem[]> {
    if (!element) {
      // Root: show "All Queries" + tags
      const items: QueryLibraryTreeItem[] = [];

      // All queries group
      const allQueries = this.bookmarkService.getAll();
      if (allQueries.length > 0) {
        items.push(new QueryLibraryTreeItem(null, true, `All (${allQueries.length})`));
      }

      // Tag groups
      const tags = this.bookmarkService.getAllTags();
      for (const tag of tags) {
        const count = this.bookmarkService.getByTag(tag).length;
        items.push(new QueryLibraryTreeItem(null, true, `${tag} (${count})`));
      }

      // If no queries at all, show empty
      if (items.length === 0) {
        return [];
      }

      return items;
    }

    // Children of a tag/group
    if (element.isTag && element.tagName) {
      let queries: SavedQuery[];
      if (element.tagName.startsWith('All (')) {
        queries = this.bookmarkService.getAll();
      } else {
        const tagName = element.tagName.replace(/\s*\(\d+\)$/, '');
        queries = this.bookmarkService.getByTag(tagName);
      }

      return queries
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(q => new QueryLibraryTreeItem(q, false));
    }

    return [];
  }

  getParent(): vscode.ProviderResult<QueryLibraryTreeItem> {
    return null;
  }
}
