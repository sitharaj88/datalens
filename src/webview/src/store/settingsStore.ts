import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light' | 'system';

interface SettingsState {
  theme: ThemeMode;
  editorFontSize: number;
  defaultPageSize: number;
  wordWrap: boolean;
  editorHeight: number;
  showLineNumbers: boolean;

  setTheme: (theme: ThemeMode) => void;
  setEditorFontSize: (size: number) => void;
  setDefaultPageSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setEditorHeight: (height: number) => void;
  setShowLineNumbers: (show: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      editorFontSize: 13,
      defaultPageSize: 50,
      wordWrap: false,
      editorHeight: 180,
      showLineNumbers: true,

      setTheme: (theme) => set({ theme }),
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
      setDefaultPageSize: (defaultPageSize) => set({ defaultPageSize }),
      setWordWrap: (wordWrap) => set({ wordWrap }),
      setEditorHeight: (editorHeight) => set({ editorHeight }),
      setShowLineNumbers: (showLineNumbers) => set({ showLineNumbers }),
    }),
    {
      name: 'db-viewer-settings',
    }
  )
);
