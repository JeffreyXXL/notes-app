/**
 * 把正文里的图片复制到系统剪贴板。
 *
 * 优先走主进程：那里能直接读原文件，不受页面 CORS 限制，也能保住原始字节。
 * 只有浏览器模式（`npm run dev`）才退到 canvas —— 那种模式下图片本来就是
 * localStorage 里的 data URL，画布不会被污染。
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

/** 浏览器兜底：画到 canvas 转 PNG 再塞进剪贴板 */
async function copyViaCanvas(url: string): Promise<boolean> {
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
    // 外链图没带 CORS 头时画布会被污染，toBlob 抛安全错误
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
    } catch (err) {
      console.error('[notes-app] 复制图片失败', err);
    }
  }

  // 主进程解不了的格式（nativeImage 不支持 SVG）退到画布。
  // 这条同时也是浏览器模式下的唯一路径。
  toast(await copyViaCanvas(url) ? '已复制图片' : '这张图复制不了');
}
