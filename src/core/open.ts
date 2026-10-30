import { hasDesktopBridge, invoke } from '../storage/ipc';

/** 用系统浏览器打开外链。桌面端走 IPC，浏览器调试时退回 window.open */
export function openExternal(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;

  if (hasDesktopBridge()) {
    void invoke('open_external', { url }).catch(() => {
      window.open(url, '_blank', 'noopener');
    });
    return;
  }
  window.open(url, '_blank', 'noopener');
}
