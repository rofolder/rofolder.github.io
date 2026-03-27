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
    target: 'esnext',

    // 청크 크기 경고 한도
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        // 파일명에 해시 붙여 브라우저 캐시 최적화
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',

        // 벤더 청크 분리
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    }
  },

  // CSS 최적화
  css: {
    devSourcemap: false
  }
})
