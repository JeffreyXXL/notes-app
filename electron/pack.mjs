/**
 * 把 dist/ + electron/ 打成一个可以直接双击的 exe 目录。
 *
 * 用 @electron/packager 而不是 electron-builder：不需要额外下载签名工具和 NSIS。
 * 但 packager 默认会联网拉 electron 压缩包，国内经常被重置连接，
 * 所以这里先找本地缓存（npm 装 electron 时已经下过一份），找到就完全离线。
 *
 * 输出策略：packager 的 overwrite 是「递归删旧目录再建」，而很多环境会拦截
 * 上百个文件的批量删除（沙箱守卫、Defender 正在扫那个 181MB 的 exe）。
 * 所以先打到临时目录，再逐文件覆盖到 dist-app/ —— 只覆盖，不删除，
 * 重跑多少次都不会被拦，目录也永远只有一个。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as mod from '@electron/packager';

const require = createRequire(import.meta.url);
const packager = mod.packager || mod.default;

const electronVersion = require('electron/package.json').version;
const platform = 'win32';
const arch = 'x64';
const OUT_DIR = 'dist-app';

/** 在 %LOCALAPPDATA%\electron\Cache 里找已下载的 zip */
function findCachedZip() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
  const target = `electron-v${electronVersion}-${platform}-${arch}.zip`;
  try {
    for (const entry of fs.readdirSync(base)) {
      const dir = path.join(base, entry);
      if (fs.existsSync(path.join(dir, target))) return dir;
    }
  } catch {
    /* 没有缓存目录就让它自己下载 */
  }
  return null;
}

const zipDir = findCachedZip();
if (zipDir) console.log('使用本地缓存的 Electron：' + zipDir);
else console.log('本地没有缓存，将联网下载 Electron ' + electronVersion);

// 每次换一个全新的临时目录，packager 就不会碰到「目标已存在」的删除逻辑
const staging = path.join(os.tmpdir(), `notes-pack-${Date.now()}`);

const paths = await packager({
  dir: process.cwd(),
  name: 'Notes',
  appVersion: require('../package.json').version,
  electronVersion,
  ...(zipDir ? { electronZipDir: zipDir } : {}),
  platform,
  arch,
  out: staging,
  overwrite: true,
  asar: true,
  // 主进程只用 electron / node:fs / node:path，没有第三方依赖；
  // 渲染层已经被 vite 全量打进 dist/。所以 node_modules 完全不用带，
  // 否则 lxgw 字体那 30MB 会在 asar 里重复存一份。
  prune: false,
  icon: 'src-tauri/icons/icon.ico',
  win32metadata: {
    ProductName: '笔记',
    FileDescription: '笔记 · 三栏 Markdown 笔记',
    InternalName: 'Notes'
  },
  ignore: [
    /^\/src($|\/)/,
    /^\/src-tauri($|\/)/,
    /^\/prototype($|\/)/,
    /^\/docs($|\/)/,
    /^\/release($|\/)/,
    // 上一次的产物目录（dist-app / dist-app-2 / …）绝不能打进 asar，
    // 否则体积直接翻倍。注意别误伤 dist/，那是前端产物。
    /^\/dist-app[^/]*($|\/)/,
    /^\/node_modules($|\/)/,
    /^\/app-icon\.png$/,
    /^\/README\.md$/,
    /^\/\.gitignore$/,
    /^\/vite\.config\.ts$/,
    /^\/tsconfig\.json$/
  ]
});

/* ---------- 从临时目录覆盖到 dist-app ---------- */

const built = paths[0];

/** 正在运行的 exe 在 Windows 上无法以写方式打开 */
function isLocked(p) {
  if (!fs.existsSync(p)) return false;
  try {
    const fd = fs.openSync(p, 'r+');
    fs.closeSync(fd);
    return false;
  } catch {
    return true;
  }
}

// 优先写 dist-app；如果那里的 exe 正在运行（用户没关窗口），退到 dist-app-2/3
let outDir = OUT_DIR;
for (const dir of [OUT_DIR, `${OUT_DIR}-2`, `${OUT_DIR}-3`]) {
  if (!isLocked(path.join(dir, 'Notes-win32-x64', 'Notes.exe'))) { outDir = dir; break; }
  outDir = null;
}
if (!outDir) {
  console.error('\nNotes.exe 正在运行，所有候选目录都被占用。');
  console.error('先从托盘图标右键 → 退出，再重新打包。');
  console.error('这次的新产物在：' + built);
  process.exit(1);
}
if (outDir !== OUT_DIR) {
  console.log(`\n${OUT_DIR} 里的 Notes.exe 正在运行，本次输出到 ${outDir}/`);
  console.log('（关掉那个窗口后重新打包，就会回到 ' + OUT_DIR + '/）');
}

const dest = path.join(outDir, 'Notes-win32-x64');

try {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(built, dest, { recursive: true, force: true });
} catch (err) {
  if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
    console.error('\n写入失败：' + err.message);
    console.error('Notes.exe 正在运行，先把它关掉（托盘图标右键 → 退出）再打包。');
    console.error('这次的新产物在：' + built);
    process.exit(1);
  }
  throw err;
}

// 临时目录能删就删，删不掉交给系统清理
try {
  fs.rmSync(staging, { recursive: true, force: true });
} catch { /* 忽略 */ }

console.log('\n打包完成：' + dest);
console.log('双击 ' + path.join(dest, 'Notes.exe') + ' 即可运行。');
