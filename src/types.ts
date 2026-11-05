/** 笔记元信息 —— 存在 .md 的 front matter 里，文件即唯一真相源 */
export interface NoteMeta {
  tags: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  /**
   * 隐藏：不进列表、不进搜索、不计入目录/标签数量。
   * 和「归档」的区别是语义 —— 归档是「这件事做完了」，
   * 隐藏是「我不想看见它」，所以两者各自独立，互不覆盖。
   */
  hidden: boolean;
  /** epoch ms */
  created: number;
  /** epoch ms */
  updated: number;
  /**
   * 手动排序用的序号，越小越靠前。
   * 没写过这个字段的老笔记为 undefined，排序时落到「按更新时间」的兜底分支。
   */
  order?: number;
  /**
   * 文档笔记：正文之外还挂着一个真实文件。
   * 值是相对笔记库根的路径（`_docs/20261105-101500-ab12cd.pdf`），
   * 双击卡片就用系统默认程序打开它。
   */
  doc?: string;
  /** 文档体积（字节），只用来在卡片上显示，文件本身才是真相源 */
  docSize?: number;
}

/** 运行时笔记对象 */
export interface Note extends NoteMeta {
  /** 稳定 id，由相对路径派生（路径变了 id 也变，够用且无需额外存储） */
  id: string;
  /** 相对笔记库根的路径，如 `工作/产品/产品方向思考.md` */
  relPath: string;
  /** 目录（relPath 去掉文件名），`收集箱` 这类单层目录也支持 */
  folder: string;
  /** 文件名（不含 .md） */
  name: string;
  /** 正文，不含 front matter */
  content: string;
  /** 显示标题：正文首个 `# ` 优先，否则用文件名 */
  title: string;
  /** 文件修改时间 epoch ms */
  mtime: number;
}

export type FontId = 'sys' | 'wenkai' | 'clean';
export type ThemeMode = 'light' | 'dark' | 'auto';
/** 色系：奶油（暖米）/ 石墨（深侧边 + 朱红）/ 纸白（中性） */
export type ThemeScheme = 'cream' | 'graphite' | 'paper';
export type CloseAction = 'tray' | 'quit';
/**
 * 高亮（`==文字==`）的颜色。
 *
 * Markdown 的 `==…==` 本身不带颜色参数，所以这里是「整个库用哪支马克笔」，
 * 而不是给每一处单独上色 —— 好处是 .md 保持纯文本，别的编辑器打开也不会
 * 多出看不懂的标记。
 */
export type HlColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange';

export interface Settings {
  font: FontId;
  size: number;
  lh: number;
  reveal: boolean;
  theme: ThemeMode;
  scheme: ThemeScheme;
  swipe: boolean;
  swipeActs: { pin: boolean; archive: boolean; tag: boolean; hide: boolean; del: boolean };
  autostart: boolean;
  closeAction: CloseAction;
  leftCollapsed: boolean;
  midCollapsed: boolean;
  /** 正文 H1 改了就把文件名改成一样的 */
  titleRename: boolean;
  /** 插入笔记链接时写成 `[[目录/标题]]` 而不是 `[[标题]]`，同名笔记才分得清 */
  linkPath: boolean;
  /** `==高亮==` 用哪支颜色的马克笔 */
  hlColor: HlColor;
  /** 左栏目录的手动顺序（库内路径，从前往后） */
  folderOrder: string[];
  /** 左栏标签的手动顺序 */
  tagOrder: string[];
  /** 左上角显示的名字，也是窗口标题 */
  appName: string;
  /** 开了就要求输密码才能进 */
  lockEnabled: boolean;
  /** 密码摘要，格式 `s1:<salt>:<hex>`；空串表示还没设过 */
  lockHash: string;
}

export type Filter =
  | { type: 'folder'; value: string }
  | { type: 'tag'; value: string }
  | { type: 'group'; value: string }
  | { type: 'view'; value: 'archive' | 'trash' | 'hidden' };

export type Mode = 'folder' | 'tag' | 'group';

export interface UiState {
  mode: Mode;
  filter: Filter | null;
  selectedId: string | null;
  expanded: Set<string>;
  search: string;
}

export interface VaultInfo {
  /** 绝对路径（浏览器模式下是虚拟标识） */
  root: string;
  /** 用于界面展示的短路径 */
  label: string;
  kind: 'fs' | 'browser';
}

export interface Group {
  id: string;
  name: string;
  match: (n: Note) => boolean;
}

export interface CardAction {
  k: 'pin' | 'archive' | 'tag' | 'del' | 'restore' | 'purge' | 'hide' | 'unhide';
  cls: string;
  label: string;
  ic: string;
  on?: boolean;
}
