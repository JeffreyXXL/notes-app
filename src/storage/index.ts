import type { StorageAdapter } from './adapter';
import { DesktopStorage } from './desktop';
import { BrowserStorage } from './browser';
import { hasDesktopBridge } from './ipc';

export type { StorageAdapter, RawFile } from './adapter';
export { isTauri, isElectron, hasDesktopBridge } from './ipc';

/**
 * 运行时自动选存储：
 * 桌面外壳（Electron 或 Tauri）→ 真实文件；纯浏览器 → localStorage。
 */
export function createStorage(): StorageAdapter {
  return hasDesktopBridge() ? new DesktopStorage() : new BrowserStorage();
}
