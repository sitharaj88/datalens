import { create } from 'zustand';
import type { IQueryResult, IColumn, DatabaseCapabilities } from '../types';
import type { SortingState, ColumnFiltersState } from '@tanstack/react-table';

export interface QueryTab {
  id: string;
  title: string;
  query: string;
  result: IQueryResult | null;
  connectionId: string | null;
  tableName: string | null;
  isDirty: boolean;
  loading: boolean;
  error: string | null;
  activeView: 'data' | 'chart' | 'plan';
  columns: IColumn[];
  columnVisibility: Record<string, boolean>;
  columnOrder: string[];
  databaseType: string | null;
  capabilities: DatabaseCapabilities | null;
  pageSize: number;
  sortState: SortingState;
  filterState: ColumnFiltersState;
}

interface TabState {
  tabs: QueryTab[];
  activeTabId: string | null;

  // Tab management
  addTab: (tab?: Partial<QueryTab>) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<QueryTab>) => void;

  // Convenience getters
  getActiveTab: () => QueryTab | undefined;

  // Reorder
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (partial) => {
    const id = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newTab: QueryTab = {
      id,
      title: partial?.title || 'New Query',
      query: partial?.query || '',
      result: partial?.result || null,
      connectionId: partial?.connectionId || null,
      tableName: partial?.tableName || null,
      isDirty: false,
      loading: false,
      error: null,
      activeView: 'data',
      columns: [],
      columnVisibility: {},
      columnOrder: [],
      databaseType: null,
      capabilities: null,
      pageSize: 50,
      sortState: [],
      filterState: [],
      ...partial,
    };

    set(state => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id,
    }));

    return id;
  },

  removeTab: (id) => {
    set(state => {
      const index = state.tabs.findIndex(t => t.id === id);
      const newTabs = state.tabs.filter(t => t.id !== id);

      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        if (newTabs.length === 0) {
          newActiveId = null;
        } else {
          newActiveId = newTabs[Math.min(index, newTabs.length - 1)]?.id || null;
        }
      }

      return { tabs: newTabs, activeTabId: newActiveId };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, updates) => {
    set(state => ({
      tabs: state.tabs.map(t =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  },

  getActiveTab: () => {
    const state = get();
    return state.tabs.find(t => t.id === state.activeTabId);
  },

  reorderTabs: (fromIndex, toIndex) => {
    set(state => {
      const newTabs = [...state.tabs];
      const [removed] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, removed);
      return { tabs: newTabs };
    });
  },
}));
