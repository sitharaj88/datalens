import { create } from 'zustand';
import type { IColumn, IQueryResult } from '../types';

interface AppState {
  connectionId: string | null;
  tableName: string | null;
  columns: IColumn[];
  result: IQueryResult | null;
  loading: boolean;
  error: string | null;

  setConnectionId: (id: string | null) => void;
  setTableName: (name: string | null) => void;
  setColumns: (columns: IColumn[]) => void;
  setResult: (result: IQueryResult | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  connectionId: null,
  tableName: null,
  columns: [],
  result: null,
  loading: false,
  error: null,

  setConnectionId: (id) => set({ connectionId: id }),
  setTableName: (name) => set({ tableName: name }),
  setColumns: (columns) => set({ columns }),
  setResult: (result) => set({ result }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
