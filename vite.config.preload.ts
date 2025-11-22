import { defineConfig } from 'vite';

// Preload script config - must be CommonJS for Electron compatibility
export default defineConfig({
  build: {
    outDir: 'dist-electron',
    ssr: true,
    emptyOutDir: false, // Don't clear - main.js already there
    rollupOptions: {
      input: {
        preload: 'src/electron/preload.ts',
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs',
      },
      external: ['electron'],
    },
  },
});
