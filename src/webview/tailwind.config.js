/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'vscode-bg': 'var(--vscode-editor-background)',
        'vscode-fg': 'var(--vscode-editor-foreground)',
        'vscode-input-bg': 'var(--vscode-input-background)',
        'vscode-input-fg': 'var(--vscode-input-foreground)',
        'vscode-input-border': 'var(--vscode-input-border)',
        'vscode-button-bg': 'var(--vscode-button-background)',
        'vscode-button-fg': 'var(--vscode-button-foreground)',
        'vscode-button-hover': 'var(--vscode-button-hoverBackground)',
        'vscode-list-active': 'var(--vscode-list-activeSelectionBackground)',
        'vscode-list-hover': 'var(--vscode-list-hoverBackground)',
        'vscode-border': 'var(--vscode-panel-border)',
      },
      fontFamily: {
        mono: 'var(--vscode-editor-font-family)',
      },
      fontSize: {
        'vscode': 'var(--vscode-editor-font-size)',
      }
    },
  },
  plugins: [],
}
