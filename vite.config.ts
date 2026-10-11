import { defineConfig } from 'vite';

export default defineConfig({
  // Generated assets (threejs-3d-generator / image-generator / audio-generator)
  // land in assets/<kind>/... at the project root; serve that tree directly
  // instead of duplicating files into a separate public/ folder.
  publicDir: 'assets',
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
