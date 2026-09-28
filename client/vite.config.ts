import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** The Java server's port from seurat.conf (`http.port`), else the protocol default 8080. */
function serverPort(): number {
  try {
    const m = /^\s*http\.port\s*=\s*(\d+)/m.exec(readFileSync(resolve(here, '../seurat.conf'), 'utf8'));
    return m ? Number(m[1]) : 8080;
  } catch {
    return 8080;
  }
}

export default defineConfig({
  plugins: [react()],
  base: './',
  // Dev only: the Java server owns the Seurat endpoints (LAN, localhost).
  server: {
    proxy: {
      '/seurat': { target: `http://localhost:${serverPort()}`, changeOrigin: false, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: false },
  resolve: { alias: { '@': resolve(here, 'src') } },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
