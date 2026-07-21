import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    target: 'es2020',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
});
