import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // Proxy vers le Worker local (`wrangler dev`) en développement
    proxy: {
      '/api':  { target: 'http://localhost:8787', changeOrigin: true },
      '/auth': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  test: {
    // Tests hors du root Vite (src/), donc on les localise ici
    root: '.',
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
