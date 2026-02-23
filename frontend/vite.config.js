import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
  server: {
    port: 5342,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      }
    }
  },
  build: {
    sourcemap: false, // SECURITY: Prevent source code leakage in production
    // Monaco workers are inherently large; keep warning threshold aligned with actual split chunks.
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@monaco-editor') || id.includes('monaco-editor')) {
            return 'monaco-vendor';
          }
          return undefined;
        },
      },
    },
  }
})
