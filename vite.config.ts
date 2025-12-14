import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  publicDir: 'public',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: true,

    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  server: {
    port: 3000,
    open: true,
  },

  // Handle UXP-specific modules that won't be available during dev
  optimizeDeps: {
    exclude: ['premiere', 'uxp'],
  },
});
