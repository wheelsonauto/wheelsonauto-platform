import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/staff-dist/',
  plugins: [react()],
  build: {
    outDir: 'staff-dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: 'staff-ui/main.tsx',
      output: {
        entryFileNames: 'staff-next.js',
        chunkFileNames: 'staff-[name]-[hash].js',
        assetFileNames: asset => asset.name && asset.name.endsWith('.css') ? 'staff-next.css' : 'staff-[name]-[hash][extname]'
      }
    }
  }
});
