import { defineConfig } from 'vite';
import path from 'path';

// Electron main process config - builds for Node.js, not browser
export default defineConfig({
  build: {
    outDir: 'dist-electron',
    ssr: true, // Build for Node.js environment
    rollupOptions: {
      input: {
        main: 'src/electron/main.ts',
        preload: 'src/electron/preload.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
      external: [
        'electron',
        'fs',
        'fs/promises',
        'path',
        'child_process',
        'url',
        'glob',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
