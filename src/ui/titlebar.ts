/**
 * 无边框窗口的自绘标题栏。
 *
 * Windows / Linux 上主进程用 frame:false，系统一个按钮都不给，
 * 最小化 / 最大化 / 关闭全在这里补上；拖动由 CSS 的 -webkit-app-region 负责。
 * macOS 走 titleBarStyle:'hiddenInset'，红绿灯是系统画的，这里只负责打开拖动区。
 */

import { invoke, hasDesktopBridge } from '../storage/ipc';

export function initTitlebar(): void {
  if (!hasDesktopBridge()) return; // 浏览器调试模式：不加拖动区，也不显示按钮

  const root = document.documentElement;
  const bridge = window.notesBridge;
  const platform = bridge?.platform ?? 'win32';

  root.dataset.shell = 'desktop';
  root.dataset.os = platform;
  if (platform === 'darwin') return; // 红绿灯归系统

  const min = document.getElementById('win-min');
  const max = document.getElementById('win-max');
  const close = document.getElementById('win-close');
  if (!min || !max || !close) return;

  const paintMax = (v: boolean) => max.classList.toggle('is-max', v);
  const syncMax = () => { invoke<boolean>('win_is_max').then(paintMax).catch(() => {}); };

  min.addEventListener('click', () => { void invoke('win_minimize'); });
  max.addEventListener('click', () => { void invoke<boolean>('win_toggle_max').then(paintMax).catch(() => {}); });
  close.addEventListener('click', () => { void invoke('win_close'); });

  // Electron 有精确事件；Tauri 没有这个桥，靠 resize 兜底
  if (bridge?.onWinState) bridge.onWinState(paintMax);
  else {
    let t: number | null = null;
    window.addEventListener('resize', () => {
      if (t) clearTimeout(t);
      t = window.setTimeout(syncMax, 140);
    });
  }

  syncMax();

  // 双击顶栏空白 = 最大化 / 还原（Windows 的肌肉记忆）
  document.querySelectorAll('.brand, .mh-top, .doc-head').forEach(el => {
    el.addEventListener('dblclick', e => {
      const target = e.target as HTMLElement;
      if (target.closest('button, input, .pill, .tgl, #mid-action')) return;
      void invoke<boolean>('win_toggle_max').then(paintMax).catch(() => {});
    });
  });
}
