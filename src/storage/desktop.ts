import { invoke } from './ipc';
import type { StorageAdapter, RawFile } from './adapter';
import type { VaultInfo } from '../types';

interface VaultInfoDto { root: string; label: string }

/**
 * 桌面端存储：读写磁盘上的真实 .md 文件。
 * 具体 IO 在 Electron 主进程或 Rust 里做，这里只发命令。
 */
export class DesktopStorage implements StorageAdapter {
  readonly kind = 'fs' as const;
  private info: VaultInfo = { root: '', label: '', kind: 'fs' };

  async init(): Promise<VaultInfo> {
    const dto = await invoke<VaultInfoDto>('vault_info');
    this.info = { root: dto.root, label: dto.label, kind: 'fs' };
    return this.info;
  }

  list(): Promise<RawFile[]> {
    return invoke<RawFile[]>('vault_list');
  }

  read(relPath: string): Promise<RawFile | null> {
    return invoke<RawFile | null>('note_read', { rel_path: relPath });
  }

  write(relPath: string, raw: string): Promise<number> {
    return invoke<number>('note_write', { rel_path: relPath, raw });
  }

  async remove(relPath: string): Promise<void> {
    await invoke('note_remove', { rel_path: relPath });
  }

  async move(fromRel: string, toRel: string): Promise<void> {
    await invoke('note_move', { from_rel: fromRel, to_rel: toRel });
  }

  async prune(folderRel: string): Promise<void> {
    await invoke('vault_prune', { rel_path: folderRel });
  }

  async writeAsset(relPath: string, base64: string): Promise<void> {
    await invoke('asset_write', { rel_path: relPath, base64 });
  }

  async loadSettings(): Promise<unknown> {
    const s = await invoke<string | null>('settings_load');
    return s ? JSON.parse(s) : null;
  }

  async saveSettings(settings: unknown): Promise<void> {
    await invoke('settings_save', { json: JSON.stringify(settings) });
  }

  async reveal(): Promise<void> {
    await invoke('vault_reveal');
  }

  async setAutostart(on: boolean): Promise<void> {
    await invoke('set_autostart', { on });
  }
}
