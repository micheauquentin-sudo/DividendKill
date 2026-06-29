import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'inject-sw-version',
      writeBundle(options, bundle) {
        // Derive a short hash from the built chunk filenames (already content-hashed by Vite)
        const chunkHash = createHash('sha1')
          .update(Object.keys(bundle).sort().join('\n'))
          .digest('hex')
          .slice(0, 8);
        const swPath = join(options.dir, 'sw.js');
        try {
          let sw = readFileSync(swPath, 'utf8');
          sw = sw.replace('__DK_CACHE__', `dk-${chunkHash}`);
          writeFileSync(swPath, sw);
        } catch (e) {
          console.warn('[inject-sw-version]', e.message);
        }
      },
    },
  ],
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
