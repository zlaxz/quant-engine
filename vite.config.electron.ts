import { defineConfig } from 'vite';
import path from 'path';

// Electron main process config - builds for Node.js, not browser
// Main uses ES modules, preload needs separate CJS build
export default defineConfig({
  build: {
    outDir: 'dist-electron',
    ssr: true,
    rollupOptions: {
      input: {
        main: 'src/electron/main.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
      external: [
        'electron',
        'electron-store',
        'fs',
        'fs/promises',
        'path',
        'child_process',
        'url',
        'os',
        'glob',
        '@google/generative-ai',
        'openai',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
