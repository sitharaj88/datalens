import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
      external: ['monaco-editor'],
      output: {
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        // Inline all chunks into the main bundle to avoid dynamic import CSP issues in VS Code webview
        inlineDynamicImports: true,
      }
    },
    sourcemap: false,
    minify: 'esbuild',
    // Suppress chunk size warning since we're intentionally inlining everything
    chunkSizeWarningLimit: 10000,
  },
  define: {
    'process.env': {}
  },
  worker: {
    format: 'es',
  },
});
