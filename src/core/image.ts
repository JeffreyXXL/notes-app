/**
 * 图片资源的路径约定。
 *
 * 图片统一存到笔记库根目录下的 `_assets/`，markdown 里写的是「相对笔记库根」的路径：
 *
 *     ![海报](_assets/20261026-153022-a1b2c3.png)
 *
 * 为什么不用「相对笔记」的写法：笔记会在目录之间搬来搬去（左栏重命名、
 * 整理弹层改目录），相对路径全都得跟着重写一遍，漏改一处就变红叉。
 * 库内绝对路径不受移动影响，一次写好终身有效。
 *
 * 但用户自己手写的 `./img.png` 也得能显示，所以渲染时会先按
 * 「笔记所在目录 + 路径」找一次，找不到再按「库根 + 路径」找一次（见 main.cjs）。
 */

import { hasDesktopBridge, isTauri } from '../storage/ipc';

export const ASSET_DIR = '_assets';

const IMAGE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'
]);

/** 浏览器模式下 data URL 的存放前缀，和 BrowserStorage 的 key 命名保持一致 */
const BROWSER_ASSET_KEY = 'notes-app:assets:';

/**
 * 笔记库的绝对根目录。Tauri 侧要拼 file:// 路径，Electron 侧用不到。
 * 由 initStore 拿到 VaultInfo 之后灌进来，避免 core 层反过来依赖 store。
 */
let vaultRoot = '';

export function setVaultRoot(p: string): void {
  vaultRoot = p || '';
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function isImageFile(f: File): boolean {
  if (f.type && f.type.startsWith('image/')) return true;
  // 某些拖拽来源给不出 MIME，退一步看扩展名
  return IMAGE_EXT.has(extOf(f.name || ''));
}

/** 用文件名当图片的 alt，去掉扩展名 */
export function altOf(name: string): string {
  return (name || '').replace(/\.[^.]+$/, '').trim();
}

/**
 * 生成一个不会撞车的库内路径：`_assets/20261026-153022-a1b2c3.png`。
 * 时间戳让文件在资源管理器里天然按时间排好，随机后缀挡住同一秒里的重名。
 */
export function newAssetPath(fileName: string): string {
  const raw = extOf(fileName || '');
  const ext = IMAGE_EXT.has(raw) ? raw : 'png';

  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8);

  return `${ASSET_DIR}/${stamp}-${rand}.${ext}`;
}

/**
 * 把 markdown 里写的路径变成 `<img src>` 能用的 URL。
 *
 * base 是这篇笔记所在的目录，只在解析用户手写的相对路径时起作用。
 */
export function assetUrl(src: string, base = ''): string {
  const p = (src || '').trim();
  if (!p) return '';

  // 已经是绝对地址（外链图床 / 内嵌 data URL）就原样用
  if (/^(https?:|data:|blob:)/i.test(p)) return p;
  if (/^(vault|app|asset):/i.test(p)) return p;

  const rel = p.replace(/^\.\//, '').replace(/^\/+/, '');
  const dir = (base || '').replace(/^\/+|\/+$/g, '');

  if (isTauri()) {
    // Tauri 的 asset 协议：Windows 走 http://asset.localhost，其它平台走 asset://
    // 需要在 tauri.conf.json 的 security.assetProtocol 里放行
    const full = [vaultRoot.replace(/\\/g, '/').replace(/\/+$/, ''), dir, rel]
      .filter(Boolean).join('/');
    const enc = full.split('/').map(encodeURIComponent).join('/');
    return /^[a-z]:/i.test(full)
      ? `http://asset.localhost/${enc}`
      : `asset://localhost/${enc}`;
  }

  if (!hasDesktopBridge()) {
    // 浏览器模式（npm run dev）：图片以 data URL 存在 localStorage 里
    for (const k of [dir ? `${dir}/${rel}` : '', rel]) {
      if (!k) continue;
      try {
        const v = localStorage.getItem(BROWSER_ASSET_KEY + k);
        if (v) return v;
      } catch { /* 隐私模式下 localStorage 可能不可用 */ }
    }
    return '';
  }

  const segs = rel.split('/').map(encodeURIComponent).join('/');
  return `vault://local/${segs}${dir ? `?b=${encodeURIComponent(dir)}` : ''}`;
}

/** 浏览器模式：把 data URL 存进 localStorage，返回它的 key */
export function stashBrowserAsset(relPath: string, dataUrl: string): boolean {
  try {
    localStorage.setItem(BROWSER_ASSET_KEY + relPath, dataUrl);
    return true;
  } catch {
    return false;
  }
}

/** 读成 base64（去掉 `data:image/png;base64,` 前缀） */
export function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error('读取文件失败'));
    r.readAsDataURL(file);
  });
}

/** 读成完整 data URL（浏览器模式用） */
export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error ?? new Error('读取文件失败'));
    r.readAsDataURL(file);
  });
}
