import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface QueryHistoryItem {
  id: string;
  query: string;
  timestamp: number;
  executionTime?: number;
  rowCount?: number;
  error?: string;
  connectionId: string;
}

interface QueryHistoryStore {
  history: QueryHistoryItem[];
  maxItems: number;
  addQuery: (item: Omit<QueryHistoryItem, 'id' | 'timestamp'>) => void;
  removeQuery: (id: string) => void;
  clearHistory: () => void;
  getRecentQueries: (connectionId: string, limit?: number) => QueryHistoryItem[];
}

export const useQueryHistory = create<QueryHistoryStore>()(
  persist(
    (set, get) => ({
      history: [],
      maxItems: 100,

      addQuery: (item) => {
        const newItem: QueryHistoryItem = {
          ...item,
          id: `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
        };

        set((state) => {
          // Remove duplicates of the same query
          const filteredHistory = state.history.filter(
            (h) => h.query.trim().toLowerCase() !== item.query.trim().toLowerCase()
          );

          // Add new item at the beginning
          const newHistory = [newItem, ...filteredHistory].slice(0, state.maxItems);

          return { history: newHistory };
        });
      },

      removeQuery: (id) => {
        set((state) => ({
          history: state.history.filter((h) => h.id !== id),
        }));
      },

      clearHistory: () => {
        set({ history: [] });
      },

      getRecentQueries: (connectionId, limit = 10) => {
        return get()
          .history.filter((h) => h.connectionId === connectionId)
          .slice(0, limit);
      },
    }),
    {
      name: 'db-viewer-query-history',
    }
  )
);

// Format relative time
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}
