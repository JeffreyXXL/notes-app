/**
 * 桌面外壳的命令通道。
 *
 * 两个外壳（Electron / Tauri）用同一套命令名和参数，
 * 这里只负责按运行环境选一个传输方式，上层存储层完全无感。
 */

export interface NotesBridge {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  /** 只在 Electron 下存在 */
  platform?: string;
  onWinState?(cb: (isMax: boolean) => void): void;
}

declare global {
  interface Window {
    notesBridge?: NotesBridge;
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.notesBridge;
}

export function hasDesktopBridge(): boolean {
  return isElectron() || isTauri();
}

type Invoker = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let tauriInvoke: Invoker | null = null;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Electron：preload 暴露的桥
  if (window.notesBridge) {
    return window.notesBridge.invoke(cmd, args) as Promise<T>;
  }

  // Tauri：动态加载，浏览器模式下不会打到这个包
  if (!tauriInvoke) {
    const mod = await import('@tauri-apps/api/core');
    tauriInvoke = mod.invoke as Invoker;
  }
  return tauriInvoke(cmd, args) as Promise<T>;
}
