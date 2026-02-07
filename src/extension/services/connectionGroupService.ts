import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import type { IConnectionGroup, IConnectionConfig } from '../../shared/types/database';

const GROUPS_KEY = 'dbViewer.groups';
const CONNECTIONS_KEY = 'dbViewer.connections';

export class ConnectionGroupService {
  private context: vscode.ExtensionContext;
  private groups: Map<string, IConnectionGroup> = new Map();

  private _onGroupsChanged = new vscode.EventEmitter<void>();
  readonly onGroupsChanged = this._onGroupsChanged.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadGroups();
  }

  private loadGroups(): void {
    const stored = this.context.globalState.get<IConnectionGroup[]>(GROUPS_KEY, []);
    this.groups.clear();
    for (const group of stored) {
      this.groups.set(group.id, group);
    }
  }

  private async saveGroups(): Promise<void> {
    const groups = Array.from(this.groups.values());
    await this.context.globalState.update(GROUPS_KEY, groups);
  }

  createGroup(name: string, color?: string, parentId?: string): IConnectionGroup {
    const group: IConnectionGroup = {
      id: uuidv4(),
      name,
      color,
      parentId,
      order: this.groups.size,
    };

    this.groups.set(group.id, group);
    this.saveGroups();
    this._onGroupsChanged.fire();

    return group;
  }

  updateGroup(group: IConnectionGroup): void {
    if (!this.groups.has(group.id)) {
      throw new Error(`Group not found: ${group.id}`);
    }

    this.groups.set(group.id, group);
    this.saveGroups();
    this._onGroupsChanged.fire();
  }

  deleteGroup(groupId: string): void {
    if (!this.groups.has(groupId)) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Re-parent child groups to the deleted group's parent
    const deletedGroup = this.groups.get(groupId)!;
    for (const group of this.groups.values()) {
      if (group.parentId === groupId) {
        group.parentId = deletedGroup.parentId;
      }
    }

    // Unassign connections from the deleted group
    const connections = this.context.globalState.get<IConnectionConfig[]>(CONNECTIONS_KEY, []);
    const updated = connections.map((conn) =>
      conn.groupId === groupId ? { ...conn, groupId: undefined, groupName: undefined } : conn
    );
    this.context.globalState.update(CONNECTIONS_KEY, updated);

    this.groups.delete(groupId);
    this.saveGroups();
    this._onGroupsChanged.fire();
  }

  getGroups(): IConnectionGroup[] {
    return Array.from(this.groups.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  getGroupChildren(groupId: string): IConnectionGroup[] {
    return Array.from(this.groups.values())
      .filter((group) => group.parentId === groupId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  moveConnectionToGroup(connectionId: string, groupId: string): void {
    // Validate the target group exists
    if (!this.groups.has(groupId)) {
      throw new Error(`Group not found: ${groupId}`);
    }

    const connections = this.context.globalState.get<IConnectionConfig[]>(CONNECTIONS_KEY, []);
    const group = this.groups.get(groupId)!;

    const updated = connections.map((conn) =>
      conn.id === connectionId ? { ...conn, groupId, groupName: group.name } : conn
    );

    this.context.globalState.update(CONNECTIONS_KEY, updated);
    this._onGroupsChanged.fire();
  }

  dispose(): void {
    this._onGroupsChanged.dispose();
  }
}
