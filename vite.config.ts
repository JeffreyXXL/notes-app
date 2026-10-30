import { defineConfig } from 'vite';

// Tauri 开发时固定端口，打包后用相对路径加载资源
export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  build: {
    // WebView2 / WKWebView 都支持 es2021
    target: 'es2021',
    outDir: 'dist',
    // 交给 scripts/clean-dist.mjs 逐个删，见那里的注释
    emptyOutDir: false,
    sourcemap: false,
    chunkSizeWarningLimit: 1200
  }
});
