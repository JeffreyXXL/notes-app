import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 版本号只有一个来源：package.json。构建时整个替换掉 `__APP_VERSION__`，
// 界面上就能显示「我到底跑的是哪个版本」—— 光看 exe 是看不出来的
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version: string };

// Tauri 开发时固定端口，打包后用相对路径加载资源
export default defineConfig({
  base: './',
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
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
