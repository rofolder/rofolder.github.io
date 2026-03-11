import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  server: {
    open: false,
    port: 5173
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    target: 'esnext'
  }
})
