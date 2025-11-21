import { defineConfig } from 'vite';
import path from 'path';

// Electron main process config
export default defineConfig({
  build: {
    outDir: 'dist-electron',
    lib: {
      entry: {
        main: 'src/electron/main.ts',
        preload: 'src/electron/preload.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['electron', 'fs', 'path', 'child_process', 'glob'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
