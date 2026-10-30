import type { Settings, FontId } from './types';

export const DEFAULT_SETTINGS: Settings = {
  font: 'sys',
  size: 14.5,
  lh: 1.9,
  reveal: true,
  theme: 'light',
  scheme: 'cream',
  swipe: true,
  swipeActs: { pin: true, archive: true, tag: true, hide: true, del: true },
  autostart: false,
  closeAction: 'tray',
  leftCollapsed: false,
  midCollapsed: false,
  titleRename: true,
  linkPath: true,
  folderOrder: [],
  tagOrder: [],
  appName: '笔记',
  lockEnabled: false,
  lockHash: ''
};

export interface FontDef {
  id: FontId;
  name: string;
  css: string;
}

export const FONTS: FontDef[] = [
  {
    id: 'sys',
    name: '系统默认',
    css: "-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
  },
  {
    id: 'wenkai',
    name: '霞鹜文楷',
    css: "'LXGW WenKai','PingFang SC','Microsoft YaHei',serif"
  },
  {
    id: 'clean',
    name: 'Inter + 思源黑',
    css: "'Inter','PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif"
  }
];

/** 老版本设置文件可能缺字段，合并兜底 */
export function mergeSettings(raw: unknown): Settings {
  const s = (raw || {}) as Partial<Settings>;
  const name = typeof s.appName === 'string' ? s.appName.trim() : '';
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    swipeActs: { ...DEFAULT_SETTINGS.swipeActs, ...(s.swipeActs || {}) },
    folderOrder: Array.isArray(s.folderOrder) ? s.folderOrder : [],
    tagOrder: Array.isArray(s.tagOrder) ? s.tagOrder : [],
    // 名字清空等于没设，别让左上角变成一片空白
    appName: name || DEFAULT_SETTINGS.appName,
    lockEnabled: !!s.lockEnabled,
    lockHash: typeof s.lockHash === 'string' ? s.lockHash : ''
  };
}
