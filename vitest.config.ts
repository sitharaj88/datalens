import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // The real `vscode` module is only provided by the VS Code host at runtime.
      vscode: resolve(__dirname, 'test/vscode-mock.ts'),
    },
  },
});
