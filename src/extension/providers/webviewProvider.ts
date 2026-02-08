import * as vscode from 'vscode';
import type { ConnectionService } from '../services/connectionService';
import { MessageRouter } from '../services/messageRouter';
import type { Message } from '../../shared/types/messages';
import type { AIService } from '../services/aiService';
import type { QueryBookmarkService } from '../services/queryBookmarkService';
import { AdapterFactory } from '../database/factory';
import { buildCapabilities } from '../services/capabilitiesBuilder';

export class QueryWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dbViewer.queryPanel';

  private view?: vscode.WebviewView;
  private extensionUri: vscode.Uri;
  private messageRouter: MessageRouter;

  constructor(
    extensionUri: vscode.Uri,
    connectionService: ConnectionService
  ) {
    this.extensionUri = extensionUri;
    this.messageRouter = new MessageRouter(connectionService);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'dist')
      ]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: Message) => {
      if (message.type === 'SAVE_FILE') {
        const response = await handleSaveFile(message);
        this.view?.webview.postMessage(response);
        return;
      }
      const response = await this.messageRouter.route(message);
      this.view?.webview.postMessage(response);
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'dist', 'assets', 'main.js')
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'dist', 'assets', 'main.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'nonce-${nonce}' ${webview.cspSource} blob: https://cdn.jsdelivr.net; worker-src ${webview.cspSource} blob: https://cdn.jsdelivr.net; font-src ${webview.cspSource} data: https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Database Query</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public postMessage(message: unknown): void {
    this.view?.webview.postMessage(message);
  }
}

export class QueryPanelManager {
  private panels = new Map<string, vscode.WebviewPanel>();
  private extensionUri: vscode.Uri;
  private connectionService: ConnectionService;
  private messageRouter: MessageRouter;

  constructor(extensionUri: vscode.Uri, connectionService: ConnectionService) {
    this.extensionUri = extensionUri;
    this.connectionService = connectionService;
    this.messageRouter = new MessageRouter(connectionService);
  }

  public setAIService(service: AIService): void {
    this.messageRouter.setAIService(service);
  }

  public setBookmarkService(service: QueryBookmarkService): void {
    this.messageRouter.setBookmarkService(service);
  }

  public createOrShowPanel(connectionId: string, tableName?: string): vscode.WebviewPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const panelKey = tableName ? `${connectionId}:${tableName}` : connectionId;
    const existingPanel = this.panels.get(panelKey);

    if (existingPanel) {
      existingPanel.reveal(column);
      return existingPanel;
    }

    const connection = this.connectionService.getConnection(connectionId);
    const title = tableName
      ? `${tableName} - ${connection?.name || 'Query'}`
      : `Query - ${connection?.name || 'Database'}`;

    const panel = vscode.window.createWebviewPanel(
      'dbViewerQuery',
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'dist'),
          vscode.Uri.joinPath(this.extensionUri, 'dist')
        ]
      }
    );

    panel.webview.html = this.getHtmlForWebview(panel.webview, connectionId, tableName);

    panel.webview.onDidReceiveMessage(
      async (message: Message) => {
        if (message.type === 'SAVE_FILE') {
          const response = await handleSaveFile(message);
          panel.webview.postMessage(response);
          return;
        }
        const response = await this.messageRouter.route(message);
        panel.webview.postMessage(response);
      },
      undefined
    );

    panel.onDidDispose(() => {
      this.panels.delete(panelKey);
    });

    this.panels.set(panelKey, panel);
    return panel;
  }

  private getHtmlForWebview(
    webview: vscode.Webview,
    connectionId: string,
    tableName?: string
  ): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'dist', 'assets', 'main.js')
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'dist', 'assets', 'main.css')
    );

    const nonce = getNonce();

    const connection = this.connectionService.getConnection(connectionId);
    const adapter = AdapterFactory.get(connectionId);
    const capabilities = adapter?.isConnected() ? buildCapabilities(adapter) : null;

    const initialState = JSON.stringify({
      connectionId,
      tableName: tableName || null,
      databaseType: connection?.type || null,
      capabilities,
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'nonce-${nonce}' ${webview.cspSource} blob: https://cdn.jsdelivr.net; worker-src ${webview.cspSource} blob: https://cdn.jsdelivr.net; font-src ${webview.cspSource} data: https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Database Query</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">
        window.initialState = ${initialState};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public disposeAll(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}

async function handleSaveFile(message: Message): Promise<{ id: string; success: boolean; error?: string }> {
  const { content, defaultName, fileType } = message.payload as {
    content: string;
    defaultName: string;
    fileType: string;
  };

  try {
    const filters: Record<string, string[]> = {};
    filters[fileType.toUpperCase()] = [fileType];

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultName),
      filters,
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
      return { id: message.id, success: true };
    }
    return { id: message.id, success: false, error: 'Save cancelled' };
  } catch (err) {
    return { id: message.id, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
