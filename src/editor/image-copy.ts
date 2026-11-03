/**
 * 把正文里的图片复制到系统剪贴板。
 *
 * 优先走主进程：那里能直接读原文件，不受页面 CORS 限制，也能保住原始字节。
 * 主进程解不了的格式（nativeImage 不支持 SVG）就在画布里栅格化成 PNG，
 * 再把 PNG 交回主进程写剪贴板。
 *
 * 为什么不让渲染进程自己调 `navigator.clipboard.write` 写：窗口不在前台时
 * 这个调用会**返回成功但什么都没写**，用户看到「已复制图片」却粘不出东西，
 * 比直接报错更糟。Electron 的 clipboard 没这个问题，所以统一走它。
 * 浏览器模式（`npm run dev`）没有这座桥，才退到 navigator。
 */

import { invoke, hasDesktopBridge } from '../storage/ipc';
import { assetUrl } from '../core/image';
import { toast } from '../core/toast';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 复制用的这张是新建的，必须带 crossOrigin 重新取一次：
    // 正文里那张 <img> 是不带 CORS 加载的，已经污染了画布，拿它 toBlob 会抛错。
    // vault:// 的响应带了 access-control-allow-origin，所以这一张是干净的。
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

/** 画到 canvas 再导出成 PNG data URL；外链图没带 CORS 头会被污染，这时返回空串 */
async function rasterize(url: string): Promise<string> {
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

/** 浏览器兜底：直接往 navigator 的剪贴板里塞 PNG */
async function copyViaNavigator(url: string): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param src  markdown 里写的原始路径（`_assets/x.png` / `https://…` / `data:…`）
 * @param base 这篇笔记所在的目录，用来解析手写的相对路径
 */
export async function copyImageToClipboard(src: string, base = ''): Promise<void> {
  const url = assetUrl(src, base);
  if (!url) {
    toast('找不到这张图');
    return;
  }

  if (hasDesktopBridge()) {
    try {
      // 主进程能直接读原文件，字节和格式都是原样
      if (await invoke<boolean>('clipboard_image', { src, base })) {
        toast('已复制图片');
        return;
      }
      // 走到这里说明 nativeImage 解不了（SVG）。栅格化成 PNG 再交给主进程，
      // 写进去的是位图，粘到微信 / Word 里照样能显示
      const png = await rasterize(url);
      if (png && await invoke<boolean>('clipboard_image', { src: png, base: '' })) {
        toast('已复制图片');
        return;
      }
    } catch (err) {
      console.error('[notes-app] 复制图片失败', err);
    }
    toast('这张图复制不了');
    return;
  }

  toast(await copyViaNavigator(url) ? '已复制图片' : '这张图复制不了');
}
