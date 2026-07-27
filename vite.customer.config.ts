import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'customer-dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: 'customer-ui/main.tsx',
      output: {
        entryFileNames: 'customer-next.js',
        chunkFileNames: 'customer-[name]-[hash].js',
        assetFileNames: asset => asset.name && asset.name.endsWith('.css') ? 'customer-next.css' : 'customer-[name]-[hash][extname]'
      }
    }
  }
});

