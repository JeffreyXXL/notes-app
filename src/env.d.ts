/**
 * 构建期常量：vite.config.ts 里用 define 把 `__APP_VERSION__` 整个替换成
 * package.json 的 version。单独放一个 .d.ts，是为了让它成为**全局**声明 ——
 * 写在 types.ts 那种模块文件里的话只有那个文件看得见。
 */
declare const __APP_VERSION__: string;
