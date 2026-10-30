import type { Note, Settings, UiState, Filter, VaultInfo, Group } from './types';
import type { StorageAdapter, RawFile } from './storage';
import { createStorage } from './storage';
import { parseFrontMatter, serializeFrontMatter } from './core/frontmatter';
import { titleOf, searchNotes } from './core/fuzzy';
import { todoStats } from './core/text';
import { dirOf, baseName, normalizeFolder, uniquePath, sanitizeName, joinPath, DEFAULT_FOLDER } from './core/path';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';
import { SEED_NOTES } from './seed';
import { emitChange } from './bus';

/* ============================================================
   全局可变状态
   ============================================================ */

export const store = {
  notes: [] as Note[],
  settings: { ...DEFAULT_SETTINGS } as Settings,
  state: {
    mode: 'folder',
    filter: null,
    selectedId: null,
    expanded: new Set<string>(),
    search: ''
  } as UiState,
  vault: { root: '', label: '', kind: 'browser' } as VaultInfo,
  storage: null as StorageAdapter | null,
  totalBytes: 0
};

/* ============================================================
   文件 → Note
   ============================================================ */

function toNote(f: RawFile): Note {
  const { meta, body } = parseFrontMatter(f.raw);
  const rawFolder = dirOf(f.relPath);
  const name = baseName(f.relPath);
  return {
    // 用相对路径当 id：路径变了 id 跟着变，移动时同步更新选中项即可
    id: f.relPath,
    relPath: f.relPath,
    folder: rawFolder || DEFAULT_FOLDER,
    name,
    content: body,
    title: titleOf(body, name),
    mtime: f.mtime,
    tags: meta.tags ?? [],
    pinned: !!meta.pinned,
    archived: !!meta.archived,
    trashed: !!meta.trashed,
    hidden: !!meta.hidden,
    created: meta.created ?? f.mtime,
    updated: meta.updated ?? f.mtime,
    order: typeof meta.order === 'number' ? meta.order : undefined
  };
}

function toRaw(n: Note): string {
  return serializeFrontMatter(
    {
      tags: n.tags,
      pinned: n.pinned,
      archived: n.archived,
      trashed: n.trashed,
      hidden: n.hidden,
      created: n.created,
      updated: n.updated,
      order: n.order
    },
    n.content
  );
}

/* ============================================================
   加载 / 首次导入示例
   ============================================================ */

async function seedVault(): Promise<void> {
  const storage = store.storage!;
  const existing = new Set<string>();
  const now = Date.now();

  for (const s of SEED_NOTES) {
    const relPath = uniquePath(existing, normalizeFolder(s.folder), titleOf(s.content, '无标题'));
    existing.add(relPath.toLowerCase());
    const ts = now - s.agoHours * 3600_000;
    const meta = {
      tags: s.tags,
      pinned: !!s.pinned,
      archived: !!s.archived,
      trashed: !!s.trashed,
      hidden: false,
      created: ts,
      updated: ts
    };
    await storage.write(relPath, serializeFrontMatter(meta, s.content));
  }
}

export async function initStore(): Promise<void> {
  const storage = createStorage();
  store.storage = storage;
  store.vault = await storage.init();

  const raw = await storage.loadSettings();
  store.settings = mergeSettings(raw);

  await reload({ seedIfEmpty: true });
  // 老笔记的占位符文件名对齐成正文标题（只动「无标题」这类名字）
  try {
    const n = await syncPlaceholderNames();
    if (n) console.log('[notes-app] 按标题对齐了 ' + n + ' 个文件名');
  } catch (err) {
    console.error('[notes-app] 对齐文件名失败', err);
  }
}

export async function reload(opts: { seedIfEmpty?: boolean } = {}): Promise<void> {
  const storage = store.storage!;
  let files = await storage.list();

  if (!files.length && opts.seedIfEmpty) {
    await seedVault();
    files = await storage.list();
  }

  const enc = new TextEncoder();
  store.totalBytes = files.reduce((sum, f) => sum + enc.encode(f.raw).length, 0);
  store.notes = files.map(toNote);

  // 选中的笔记如果已经不存在，清掉选中
  if (store.state.selectedId && !store.notes.some(n => n.id === store.state.selectedId)) {
    store.state.selectedId = null;
  }
}

/* ============================================================
   写盘（防抖）
   ============================================================ */

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** 按标题改文件名的防抖表：打字时别每敲一个字就改一次文件名 */
const nameTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function queueSave(note: Note): void {
  const old = pending.get(note.id);
  if (old) clearTimeout(old);
  pending.set(note.id, setTimeout(() => { void flushNote(note); }, 450));
}

export async function flushNote(note: Note): Promise<void> {
  const t = pending.get(note.id);
  if (t) { clearTimeout(t); pending.delete(note.id); }
  if (!store.storage) return;
  try {
    note.mtime = await store.storage.write(note.relPath, toRaw(note));
  } catch (err) {
    console.error('[notes-app] 保存失败', note.relPath, err);
  }
}

export async function flushAll(): Promise<void> {
  const ids = [...pending.keys()];
  for (const id of ids) {
    const n = noteById(id);
    if (n) await flushNote(n);
  }
}

/* ============================================================
   查询
   ============================================================ */

export function noteById(id: string | null): Note | undefined {
  if (!id) return undefined;
  return store.notes.find(n => n.id === id);
}

/** 正常可见的笔记：没删、没归档、没隐藏 */
export function liveNotes(): Note[] {
  return store.notes.filter(n => !n.trashed && !n.archived && !n.hidden);
}

export function archivedNotes(): Note[] {
  return store.notes.filter(n => n.archived && !n.trashed && !n.hidden);
}

export function trashedNotes(): Note[] {
  return store.notes.filter(n => n.trashed);
}

export function hiddenNotes(): Note[] {
  return store.notes.filter(n => n.hidden && !n.trashed);
}

export function groups(): Group[] {
  return [
    { id: 'g1', name: '本周重点', match: n => n.pinned },
    {
      id: 'g2', name: '未完成待办', match: n => {
        const t = todoStats(n.content);
        return t.total - t.done > 0;
      }
    },
    { id: 'g3', name: '全部笔记', match: () => true }
  ];
}

/** 统一作用域：view（归档/废纸篓）优先，其次按目录/标签/分组过滤 */
export function baseNotes(): Note[] {
  const f: Filter | null = store.state.filter;

  if (f && f.type === 'view') {
    if (f.value === 'trash') return trashedNotes();
    if (f.value === 'hidden') return hiddenNotes();
    return archivedNotes();
  }

  let list = liveNotes();
  if (f) {
    if (f.type === 'folder') list = list.filter(n => n.folder === f.value || n.folder.startsWith(f.value + '/'));
    if (f.type === 'tag') list = list.filter(n => n.tags.includes(f.value));
    if (f.type === 'group') {
      const g = groups().find(x => x.id === f.value);
      if (g) list = list.filter(g.match);
    }
  }
  return list;
}

/* ============================================================
   排序：置顶 → 手动序号 → 更新时间兜底
   ============================================================ */

/** 没排过序的笔记落到最后，靠 updated 决定它们的相对位置 */
function orderOf(n: Note): number {
  return typeof n.order === 'number' ? n.order : Number.MAX_SAFE_INTEGER;
}

export function sortNotes(list: Note[]): Note[] {
  return list.slice().sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
    orderOf(a) - orderOf(b) ||
    b.updated - a.updated);
}

/** 序号间隔：留出足够空隙，中间插一条不用重排别人 */
const ORDER_STEP = 1000;

/**
 * 把一批笔记的手动序号「落实」到文件里。
 * 老笔记没有 order 字段，第一次拖拽时按当前显示顺序补上，
 * 之后排序就不再受「更新时间」影响了。
 */
async function ensureOrders(list: Note[]): Promise<void> {
  const missing = list.filter(n => typeof n.order !== 'number');
  if (!missing.length) return;
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (typeof n.order === 'number') continue;
    n.order = (i + 1) * ORDER_STEP;
    await flushNote(n);
  }
}

/**
 * 把某篇笔记挪到目标位置（目标位置是「渲染出来的列表」里的插入下标）。
 * 只写被移动的那一篇：给它一个落在前后邻居之间的序号。
 */
export async function reorderNote(id: string, toIndex: number): Promise<void> {
  const list = currentNotes();
  const from = list.findIndex(n => n.id === id);
  if (from < 0) return;

  await ensureOrders(list);

  const moved = list[from];
  const rest = list.filter(n => n.id !== id);
  let at = toIndex > from ? toIndex - 1 : toIndex;
  at = Math.max(0, Math.min(rest.length, at));
  if (at === from) return;

  const prev = rest[at - 1];
  const next = rest[at];

  // 前后挨得太近（中点会退化成同一个数）就整段重排
  if (prev && next && (next.order as number) - (prev.order as number) < 1) {
    const seq = rest.slice();
    seq.splice(at, 0, moved);
    for (let i = 0; i < seq.length; i++) {
      seq[i].order = (i + 1) * ORDER_STEP;
      await flushNote(seq[i]);
    }
    emitChange();
    return;
  }

  let value: number;
  if (!prev && !next) value = ORDER_STEP;
  else if (!prev) value = (next!.order as number) - ORDER_STEP;
  else if (!next) value = (prev.order as number) + ORDER_STEP;
  else value = ((prev.order as number) + (next.order as number)) / 2;

  // 拖拽只改位置，不算「编辑」，所以不动 updated
  moved.order = value;
  await flushNote(moved);
  emitChange();
}

export function currentNotes(): Note[] {
  const q = store.state.search.trim();
  const base = baseNotes();
  if (q) return searchNotes(q, base);
  return sortNotes(base);
}

export function midTitle(): string {
  const f = store.state.filter;
  if (!f) return '全部笔记';
  if (f.type === 'folder') return f.value.split('/').pop() || f.value;
  if (f.type === 'tag') return '#' + f.value;
  if (f.type === 'view') {
    if (f.value === 'trash') return '废纸篓';
    return f.value === 'hidden' ? '已隐藏' : '归档';
  }
  const g = groups().find(x => x.id === f.value);
  return g ? g.name : '全部笔记';
}

export function allFolders(): string[] {
  const set = new Set<string>();
  store.notes.forEach(n => {
    let cur = '';
    n.folder.split('/').filter(Boolean).forEach(p => {
      cur = cur ? cur + '/' + p : p;
      set.add(cur);
    });
  });
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
}

export function allTags(): string[] {
  const map = new Map<string, number>();
  store.notes.forEach(n => n.tags.forEach(t => map.set(t, (map.get(t) || 0) + 1)));
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

/* ============================================================
   变更操作
   ============================================================ */

export function selectNote(id: string | null): void {
  store.state.selectedId = id;
  emitChange();
}

export async function createNote(): Promise<Note | null> {
  const storage = store.storage;
  if (!storage) return null;

  // 在「归档 / 废纸篓 / 已隐藏」里新建时先退出该视图
  if (store.state.filter && store.state.filter.type === 'view') store.state.filter = null;

  /**
   * 新笔记继承当前选中的目录 / 标签。
   *
   * 在「工作/产品」里点新建，笔记就落进那个目录；在某个标签下点新建，
   * 笔记就带上那个标签 —— 否则建完立刻从当前列表里消失，看着像「新建失败」。
   * 分组（本周重点 / 未完成待办）没有对应的归属关系，按默认目录走。
   */
  const f = store.state.filter;
  const folder = f && f.type === 'folder' ? f.value : DEFAULT_FOLDER;
  const tags = f && f.type === 'tag' ? [f.value] : [];

  const existing = new Set(store.notes.map(n => n.relPath.toLowerCase()));
  const relPath = uniquePath(existing, folder, '无标题');
  const now = Date.now();
  const content = '# 无标题\n\n';

  // 新笔记排在最前面：序号取当前最小值再减一格
  let minOrder = Number.POSITIVE_INFINITY;
  for (const n of store.notes) {
    if (typeof n.order === 'number' && n.order < minOrder) minOrder = n.order;
  }
  const order = Number.isFinite(minOrder) ? minOrder - ORDER_STEP : ORDER_STEP;

  await storage.write(relPath, serializeFrontMatter(
    { tags, pinned: false, archived: false, trashed: false, hidden: false, created: now, updated: now, order },
    content
  ));

  const note: Note = {
    id: relPath,
    relPath,
    folder,
    name: baseName(relPath),
    content,
    title: '无标题',
    mtime: now,
    tags,
    pinned: false,
    archived: false,
    trashed: false,
    hidden: false,
    created: now,
    updated: now,
    order
  };
  store.notes.unshift(note);
  store.state.selectedId = note.id;
  store.state.search = '';
  emitChange();
  return note;
}

/** 修改正文：只更新内存 + 防抖写盘，不触发重绘（编辑器自己维护视图） */
export function setNoteContent(note: Note, content: string): void {
  note.content = content;
  note.title = titleOf(content, note.name);
  note.updated = Date.now();
  queueSave(note);
  // 标题改了文件名跟着改（可关）。防抖比写盘长一点，免得边打边改
  if (store.settings.titleRename) queueNameSync(note);
}

/** 收走空目录：改名 / 移走笔记之后，旧目录不该还留在磁盘上 */
async function pruneFolder(folder: string): Promise<void> {
  if (!folder) return;
  try { await store.storage?.prune?.(folder); } catch { /* 收不掉就算了，不影响功能 */ }
}

/** 移动到另一个目录：真删真实文件移动 */
export async function setNoteFolder(note: Note, folderInput: string): Promise<void> {
  const storage = store.storage;
  if (!storage) return;
  const folder = normalizeFolder(folderInput);
  if (folder === note.folder) return;

  const existing = new Set(store.notes.map(n => n.relPath.toLowerCase()));
  existing.delete(note.relPath.toLowerCase());
  const toRel = uniquePath(existing, folder, note.name);
  const oldFolder = note.folder;

  await flushNote(note);
  try {
    await storage.move(note.relPath, toRel);
  } catch (err) {
    console.error('[notes-app] 移动文件失败', err);
    return;
  }

  const wasSelected = store.state.selectedId === note.id;
  note.relPath = toRel;
  note.id = toRel;
  note.folder = folder;
  if (wasSelected) store.state.selectedId = toRel;
  await pruneFolder(oldFolder);
  emitChange();
}

/**
 * 重命名目录：只改最后一段，底下所有笔记的文件跟着搬过去。
 * 目录名和笔记的文件名共用一套清洗规则（Windows 非法字符、保留名）。
 */
export async function renameFolder(oldPath: string, rawName: string): Promise<void> {
  const storage = store.storage;
  if (!storage || !oldPath) return;

  const name = sanitizeName(rawName);
  const parent = dirOf(oldPath);
  const base = parent ? `${parent}/${name}` : name;
  if (base === oldPath) return;

  // 目标目录已存在就加序号。直接合并会和已有目录混在一起，用户很难再拆开
  const existing = new Set(allFolders());
  let target = base;
  for (let i = 2; existing.has(target); i++) {
    target = parent ? `${parent}/${name} ${i}` : `${name} ${i}`;
  }

  // 按「文件真实所在的目录」筛，而不是 note.folder —— 库根上的笔记
  // folder 是展示用的「收集箱」，跟着一起搬会把根目录的文件搬走
  const affected = store.notes.filter(n => {
    const d = dirOf(n.relPath);
    return d === oldPath || d.startsWith(oldPath + '/');
  });
  for (const n of affected) {
    const folder = target + dirOf(n.relPath).slice(oldPath.length);
    const toRel = joinPath(folder, n.name);
    const wasSelected = store.state.selectedId === n.id;

    await flushNote(n);
    try {
      await storage.move(n.relPath, toRel);
    } catch (err) {
      console.error('[notes-app] 重命名目录失败', n.relPath, err);
      continue;
    }

    n.relPath = toRel;
    n.id = toRel;
    n.folder = folder;
    if (wasSelected) store.state.selectedId = toRel;
  }

  // 展开态整体换前缀，重命名后子目录保持原样展开 / 收起
  const expanded = new Set<string>();
  store.state.expanded.forEach(p => {
    expanded.add(p === oldPath || p.startsWith(oldPath + '/')
      ? target + p.slice(oldPath.length)
      : p);
  });
  store.state.expanded = expanded;

  // 正筛着这个目录（或它的子目录）就跟着改
  const f = store.state.filter;
  if (f && f.type === 'folder' && (f.value === oldPath || f.value.startsWith(oldPath + '/'))) {
    store.state.filter = { type: 'folder', value: target + f.value.slice(oldPath.length) };
  }

  // 文件都搬走了，旧的空目录留在磁盘上很碍眼，收掉
  await pruneFolder(oldPath);

  emitChange();
}

/* ============================================================
   笔记链接：`[[标题]]` / `[文字](路径.md)`
   ============================================================ */

/** 把 `./a/b`、`../x` 这类相对路径按「当前笔记所在目录」拼成库内路径 */
function normalizeRel(fromFolder: string, p: string): string {
  const raw = p.startsWith('/') ? p.replace(/^\/+/, '') : p;
  const segs = (p.startsWith('/')
    ? []
    : (fromFolder ? fromFolder.split('/') : [])).concat(raw.split('/'));
  const out: string[] = [];
  for (const s of segs) {
    if (!s || s === '.') continue;
    if (s === '..') { out.pop(); continue; }
    out.push(s);
  }
  return out.join('/');
}

const stripMd = (s: string): string => s.replace(/\.md$/i, '');

/**
 * 找链接指向的笔记。从「最精确」往「最宽松」逐级退：
 * 相对路径 → 库内绝对路径 → 同名文件 → 同名标题 → 标题包含。
 * 最后两级是为了「文件改名之后 `[[旧标题]]` 还能点开」。
 */
export function resolveLink(target: string, fromFolder: string): Note | null {
  let t = (target || '').trim().replace(/^<|>$/g, '');
  if (!t) return null;
  try { t = decodeURI(t); } catch { /* 保持原样 */ }
  if (/^(https?:|mailto:|tel:|#)/i.test(t)) return null;

  const byPath = (p: string): Note | undefined =>
    store.notes.find(n => n.relPath.toLowerCase() === (stripMd(p) + '.md').toLowerCase());

  // 1. 相对当前笔记目录（带 ./ ../ 或者带目录的写法）
  if (t.startsWith('.') || t.includes('/')) {
    const hit = byPath(normalizeRel(fromFolder, t));
    if (hit) return hit;
  }

  // 2. 库内绝对路径
  const abs = byPath(t);
  if (abs) return abs;

  // 3. 同名文件（不限目录）
  const base = stripMd(t.split('/').pop() || '').toLowerCase();
  const sameName = store.notes.filter(n => n.name.toLowerCase() === base);
  if (sameName.length) {
    return sameName.find(n => n.folder === fromFolder) || sameName[0];
  }

  // 4. 同名标题
  const lower = t.toLowerCase();
  const byTitle = store.notes.filter(n => n.title.toLowerCase() === lower);
  if (byTitle.length) {
    return byTitle.find(n => n.folder === fromFolder) || byTitle[0];
  }

  // 5. 标题包含（只认唯一结果，免得点一个跳到别处）
  const loose = store.notes.filter(n => n.title.toLowerCase().includes(lower));
  return loose.length === 1 ? loose[0] : null;
}

/** 点开链接：必要时切回「能看见这篇」的视图，再选中它 */
export function followLink(target: string, fromFolder: string): Note | null {
  const n = resolveLink(target, fromFolder);
  if (!n) return null;

  store.state.search = '';
  // 目标不在当前筛选里（别的目录 / 归档 / 废纸篓）就先退出来，否则点开了却找不到
  if (!currentNotes().some(x => x.id === n.id)) store.state.filter = null;
  store.state.selectedId = n.id;
  emitChange();
  return n;
}

/* ============================================================
   标签改名
   ============================================================ */

export async function renameTag(oldTag: string, rawNext: string): Promise<void> {
  const next = rawNext.trim().replace(/^#+/, '').replace(/\s+/g, ' ');
  if (!next || next === oldTag) return;

  for (const n of store.notes) {
    if (!n.tags.includes(oldTag)) continue;
    n.tags = [...new Set(n.tags.map(t => (t === oldTag ? next : t)))];
    await flushNote(n);
  }

  const ord = store.settings.tagOrder;
  if (ord.includes(oldTag)) {
    store.settings.tagOrder = [...new Set(ord.map(t => (t === oldTag ? next : t)))];
    saveSettings();
  }

  const f = store.state.filter;
  if (f && f.type === 'tag' && f.value === oldTag) {
    store.state.filter = { type: 'tag', value: next };
  }

  emitChange();
}

/* ============================================================
   标题 → 文件名
   ============================================================ */

function queueNameSync(note: Note): void {
  const old = nameTimers.get(note.id);
  if (old) clearTimeout(old);
  nameTimers.set(note.id, setTimeout(() => {
    nameTimers.delete(note.id);
    void syncNoteName(note);
  }, 1400));
}

/** 别的笔记里指向它的链接跟着改，改完两篇都写盘 */
async function rewriteLinks(oldName: string, newName: string, oldRel: string, newRel: string): Promise<void> {
  const rx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `[[标题]]` 和 `[[目录/标题]]` 都要跟着改：开了「笔记链接带完整目录」之后，
  // 链接里会带上一段目录前缀，只认裸标题的话改完名字链接就断了
  const wiki = new RegExp('\\[\\[([^\\[\\]\\n]*/)?' + rx(oldName) + '\\]\\]', 'g');
  const mdWith = new RegExp('\\(' + rx(oldRel) + '\\)', 'gi');
  const mdNoExt = new RegExp('\\(' + rx(stripMd(oldRel)) + '\\)', 'gi');
  const newNoExt = stripMd(newRel);

  for (const n of store.notes) {
    let c = n.content;
    c = c.replace(wiki, (_m, pre?: string) => `[[${pre || ''}${newName}]]`);
    c = c.replace(mdWith, `(${newRel})`);
    c = c.replace(mdNoExt, `(${newNoExt})`);
    if (c === n.content) continue;
    n.content = c;
    await flushNote(n);
  }
}

/**
 * 正文首个 `# 标题` 变了，就把文件名改成一样的。
 * 没有 H1 的笔记（title 回退成文件名）不会触发，所以不会出现「改名改名」的死循环。
 */
export async function syncNoteName(note: Note): Promise<void> {
  const storage = store.storage;
  if (!storage) return;

  const title = (note.title || '').trim();
  if (!title) return;
  const next = sanitizeName(title);
  if (!next || next === note.name) return;

  const existing = new Set(store.notes.map(n => n.relPath.toLowerCase()));
  existing.delete(note.relPath.toLowerCase());
  // 用 relPath 的真实目录，别用 note.folder：直接放在库根的笔记，
  // folder 会退化成「收集箱」这个展示用默认值，拿它拼路径会把文件搬进收集箱
  const dir = dirOf(note.relPath);
  const toRel = uniquePath(existing, dir, next);
  if (toRel === note.relPath) return;

  const oldRel = note.relPath;
  const oldName = note.name;

  await flushNote(note);
  try {
    await storage.move(oldRel, toRel);
  } catch (err) {
    console.error('[notes-app] 按标题改名失败', err);
    return;
  }

  note.relPath = toRel;
  note.id = toRel;
  note.name = baseName(toRel);
  if (store.state.selectedId === oldRel) store.state.selectedId = toRel;

  await rewriteLinks(oldName, note.name, oldRel, toRel);
  emitChange();
}

/**
 * 「无标题」「无标题 3」「未命名」「untitled」这类名字一看就是占位符，不是用户起的。
 * 新建笔记时默认就叫「无标题」，改名功能上线之前建的笔记也全停在这儿。
 */
const PLACEHOLDER_NAME = /^(?:无标题|未命名|新建笔记|untitled|untitled note)(?:\s*\d+)?$/i;

/**
 * 启动时把**占位符文件名**对齐成正文的 `# 标题`。
 *
 * 为什么需要这一步：按标题改文件名是「正文变了才触发」的，
 * 所以功能上线之前就存在的老笔记永远不会自己改 —— 正文明明写着 `# 智能工厂`，
 * 文件名还挂着「无标题 8.md」，在资源管理器里根本认不出哪篇是哪篇。
 *
 * 只在文件名还是占位符时才动手：用户自己起过名字的文件一律不碰，
 * 免得「一开应用满库文件被改名」。关掉「按标题改文件名」开关就整段跳过。
 */
export async function syncPlaceholderNames(): Promise<number> {
  if (!store.settings.titleRename || !store.storage) return 0;
  let n = 0;
  // 改名会改 note.relPath / id，用副本遍历，别边遍历边改数组里的东西
  for (const note of [...store.notes]) {
    if (!PLACEHOLDER_NAME.test(note.name)) continue;
    const before = note.relPath;
    await syncNoteName(note);
    if (note.relPath !== before) n++;
  }
  return n;
}

export function setNoteTags(note: Note, tags: string[]): void {  note.tags = tags;
  note.updated = Date.now();
  void flushNote(note);
  emitChange();
}

export function togglePin(note: Note): void {
  note.pinned = !note.pinned;
  note.updated = Date.now();
  void flushNote(note);
  emitChange();
}

export async function toggleArchive(note: Note): Promise<void> {
  note.archived = !note.archived;
  if (note.archived) note.pinned = false;
  note.updated = Date.now();
  await flushNote(note);
  if (!currentNotes().some(n => n.id === store.state.selectedId)) store.state.selectedId = null;
  emitChange();
}

/**
 * 隐藏 / 取消隐藏。
 * 隐藏的笔记不进任何列表、不进搜索、也不计入左栏目录和标签的数量，
 * 只有在「已隐藏」入口里才看得到。
 */
export async function toggleHidden(note: Note): Promise<void> {
  note.hidden = !note.hidden;
  if (note.hidden) note.pinned = false;
  note.updated = Date.now();
  await flushNote(note);
  if (!currentNotes().some(n => n.id === store.state.selectedId)) store.state.selectedId = null;
  emitChange();
}

export async function unhideNote(note: Note): Promise<void> {
  note.hidden = false;
  note.updated = Date.now();
  await flushNote(note);
  if (!currentNotes().some(n => n.id === store.state.selectedId)) store.state.selectedId = null;
  emitChange();
}

export async function moveToTrash(note: Note): Promise<void> {
  note.trashed = true;
  note.pinned = false;
  // 删掉的笔记不该同时是「隐藏」状态 —— 不然从废纸篓恢复之后它会凭空消失
  note.hidden = false;
  note.updated = Date.now();
  await flushNote(note);
  if (store.state.selectedId === note.id) store.state.selectedId = null;
  emitChange();
}

export async function restoreNote(note: Note): Promise<void> {
  note.trashed = false;
  note.updated = Date.now();
  await flushNote(note);
  if (!currentNotes().some(n => n.id === store.state.selectedId)) store.state.selectedId = null;
  emitChange();
}

export async function purgeNote(note: Note): Promise<void> {
  const storage = store.storage;
  if (!storage) return;
  try {
    await storage.remove(note.relPath);
  } catch (err) {
    console.error('[notes-app] 删除文件失败', err);
  }
  const i = store.notes.indexOf(note);
  if (i >= 0) store.notes.splice(i, 1);
  if (store.state.selectedId === note.id) store.state.selectedId = null;
  emitChange();
}

/** 清空废纸篓：先删文件，再一次性从内存移除，避免逐条重绘 */
export async function emptyTrash(): Promise<void> {
  const list = trashedNotes();
  if (!list.length) return;

  for (const n of list) {
    try {
      await store.storage?.remove(n.relPath);
    } catch (err) {
      console.error('[notes-app] 删除文件失败', n.relPath, err);
    }
  }

  const ids = new Set(list.map(n => n.id));
  store.notes = store.notes.filter(n => !ids.has(n.id));
  if (store.state.selectedId && ids.has(store.state.selectedId)) store.state.selectedId = null;
  emitChange();
}

/* ============================================================
   设置
   ============================================================ */

let settingsTimer: ReturnType<typeof setTimeout> | null = null;

export function saveSettings(): void {
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    void store.storage?.saveSettings(store.settings);
  }, 250);
}

export function patchSettings(patch: Partial<Settings>): void {
  store.settings = { ...store.settings, ...patch };
  saveSettings();
}
