import type { StorageAdapter, RawFile } from './adapter';
import type { VaultInfo } from '../types';

const VAULT_KEY = 'notes-app:vault';
const SETTINGS_KEY = 'notes-app:settings';

type VaultMap = Record<string, { raw: string; mtime: number }>;

/**
 * 浏览器模式（`npm run dev`）：用 localStorage 模拟笔记库，
 * 方便只调前端时不用起 Rust。容量约 5MB，仅用于开发。
 */
export class BrowserStorage implements StorageAdapter {
  readonly kind = 'browser' as const;
  private info: VaultInfo = { root: 'localStorage://notes-app', label: '浏览器沙盒', kind: 'browser' };

  async init(): Promise<VaultInfo> {
    return this.info;
  }

  private load(): VaultMap {
    try {
      const raw = localStorage.getItem(VAULT_KEY);
      return raw ? (JSON.parse(raw) as VaultMap) : {};
    } catch {
      return {};
    }
  }

  private save(map: VaultMap): void {
    localStorage.setItem(VAULT_KEY, JSON.stringify(map));
  }

  async list(): Promise<RawFile[]> {
    const map = this.load();
    return Object.entries(map)
      .map(([relPath, v]) => ({ relPath, raw: v.raw, mtime: v.mtime }))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  async read(relPath: string): Promise<RawFile | null> {
    const v = this.load()[relPath];
    return v ? { relPath, raw: v.raw, mtime: v.mtime } : null;
  }

  async write(relPath: string, raw: string): Promise<number> {
    const map = this.load();
    const mtime = Date.now();
    map[relPath] = { raw, mtime };
    this.save(map);
    return mtime;
  }

  async remove(relPath: string): Promise<void> {
    const map = this.load();
    delete map[relPath];
    this.save(map);
  }

  async move(fromRel: string, toRel: string): Promise<void> {
    const map = this.load();
    const v = map[fromRel];
    if (!v) return;
    delete map[fromRel];
    map[toRel] = v;
    this.save(map);
  }

  async loadSettings(): Promise<unknown> {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async saveSettings(settings: unknown): Promise<void> {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  async setAutostart(on: boolean): Promise<void> {
    // 浏览器不支持，仅在控制台提示，避免设置项点了没反应
    console.info('[notes-app] 浏览器模式不支持开机自启，已忽略：', on);
  }
}
