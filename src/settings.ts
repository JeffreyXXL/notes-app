import type { Settings, FontId, HlColor } from './types';

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
  hlColor: 'yellow',
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

export const HL_COLORS: { id: HlColor; name: string }[] = [
  { id: 'yellow', name: '黄' },
  { id: 'green', name: '绿' },
  { id: 'blue', name: '蓝' },
  { id: 'pink', name: '粉' },
  { id: 'purple', name: '紫' },
  { id: 'orange', name: '橙' }
];

const HL_IDS = new Set<string>(HL_COLORS.map(c => c.id));

/** 是不是一个认识的色号。正文里 `==字=={xxx}` 的 xxx 要按这个过滤 */
export function isHlColor(v: unknown): v is HlColor {
  return typeof v === 'string' && HL_IDS.has(v);
}

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
    lockHash: typeof s.lockHash === 'string' ? s.lockHash : '',
    // 设置文件被手改过、或者是从更新版本降级回来的，认不出的颜色退回默认
    hlColor: HL_COLORS.some(c => c.id === s.hlColor) ? s.hlColor! : DEFAULT_SETTINGS.hlColor
  };
}
