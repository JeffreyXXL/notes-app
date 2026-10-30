import type { VaultInfo } from '../types';

export interface RawFile {
  relPath: string;
  raw: string;
  mtime: number;
}

/**
 * 存储适配器 —— core 层唯一的平台相关接缝。
 *
 * 桌面端走 Tauri IPC 读写真实 `.md` 文件；
 * 浏览器（`npm run dev`）走 localStorage，方便纯前端调试。
 * 未来接 iOS 只需再实现一个适配器，上层逻辑零改动。
 */
export interface StorageAdapter {
  readonly kind: 'fs' | 'browser';

  init(): Promise<VaultInfo>;

  /** 扫描整个笔记库，返回所有 .md 的原始内容 */
  list(): Promise<RawFile[]>;

  read(relPath: string): Promise<RawFile | null>;

  /** 写入（自动建目录、原子替换），返回新的 mtime */
  write(relPath: string, raw: string): Promise<number>;

  remove(relPath: string): Promise<void>;

  move(fromRel: string, toRel: string): Promise<void>;

  /**
   * 删掉一个空目录（往上顺带收走空掉的父目录）。
   * 改名 / 移走笔记之后调用，别在磁盘上留空壳。
   */
  prune?(folderRel: string): Promise<void>;

  /**
   * 写入二进制资源（图片）。没有文件系统的适配器可以不实现，
   * 调用方会退化成「把 data URL 塞进本地存储」。
   */
  writeAsset?(relPath: string, base64: string): Promise<void>;

  loadSettings(): Promise<unknown>;

  saveSettings(settings: unknown): Promise<void>;

  /** 在文件管理器中打开笔记库（仅桌面端） */
  reveal?(): Promise<void>;

  /** 同步「开机自启」到系统（仅桌面端） */
  setAutostart?(on: boolean): Promise<void>;
}
