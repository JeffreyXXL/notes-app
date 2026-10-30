import {
  store, liveNotes, archivedNotes, trashedNotes, hiddenNotes, groups,
  renameFolder, renameTag, saveSettings
} from '../store';
import { emitChange } from '../bus';
import { esc } from '../core/text';
import { tagStyle } from '../core/tag-color';
import { dirOf } from '../core/path';
import { ICON } from '../icons';

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  count: number;
}

interface FlatRow {
  name: string;
  path: string;
  count: number;
  depth: number;
  hasKids: boolean;
}

/** 拖完一次行之后要吞掉紧跟的那次 click，否则会顺手切换筛选 */
let rowDragged = false;

function buildTree(): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], count: 0 };
  const idx = new Map<string, TreeNode>([['', root]]);

  liveNotes().forEach(n => {
    let cur = '';
    let node = root;
    n.folder.split('/').filter(Boolean).forEach(part => {
      cur = cur ? cur + '/' + part : part;
      let child = idx.get(cur);
      if (!child) {
        child = { name: part, path: cur, children: [], count: 0 };
        idx.set(cur, child);
        node.children.push(child);
      }
      child.count++;
      node = child;
    });
  });

  return root;
}

/**
 * 手动顺序优先，没排过的落到后面按名字排。
 * 顺序存在 settings.folderOrder / tagOrder 里，是「路径数组」——
 * 存数组比存序号好维护：新加进来的东西自动排到末尾，不用回头补序号。
 */
function ordered<T>(
  items: T[],
  key: (x: T) => string,
  order: string[],
  fallback: (a: T, b: T) => number
): T[] {
  const idx = new Map(order.map((p, i) => [p, i]));
  const rank = (x: T): number => {
    const i = idx.get(key(x));
    return i === undefined ? Number.MAX_SAFE_INTEGER : i;
  };
  return items.slice().sort((a, b) => rank(a) - rank(b) || fallback(a, b));
}

function flatten(node: TreeNode, depth: number, out: FlatRow[]): FlatRow[] {
  const kids = ordered(node.children, c => c.path, store.settings.folderOrder,
    (a, b) => a.name.localeCompare(b.name, 'zh'));
  kids.forEach(c => {
    out.push({ name: c.name, path: c.path, count: c.count, depth, hasKids: c.children.length > 0 });
    if (store.state.expanded.has(c.path)) flatten(c, depth + 1, out);
  });
  return out;
}

function rowHTML(cls: string, icon: string, label: string, count: number, extra: string): string {
  return `<div class="row ${cls}" ${extra}>
    <span class="ic">${icon}</span>
    <span class="label">${esc(label)}</span>
    <span class="cnt">${count}</span>
  </div>`;
}

function isActiveFolder(path: string): boolean {
  const f = store.state.filter;
  return !!f && f.type === 'folder' && f.value === path;
}

export function renderLeft(): void {
  const tree = document.getElementById('tree');
  if (!tree) return;

  let html = '';
  const live = liveNotes();

  if (store.state.mode === 'folder') {
    html += `<div class="row ${!store.state.filter ? 'active' : ''}" data-clear="1">
      <span class="ic">${ICON.all}</span><span class="label">全部笔记</span>
      <span class="cnt">${live.length}</span></div>`;
    html += '<div class="sec-label">目录</div>';

    flatten(buildTree(), 0, []).forEach(r => {
      const open = store.state.expanded.has(r.path);
      html += `<div class="row ${isActiveFolder(r.path) ? 'active' : ''}"
        data-folder="${esc(r.path)}" data-path="${esc(r.path)}" data-kind="folder"
        data-parent="${esc(dirOf(r.path))}" data-depth="${r.depth}"
        style="padding-left:${8 + r.depth * 15}px">
        <span class="chev ${open ? 'open' : ''}" data-chev="${esc(r.path)}">${r.hasKids ? ICON.chev : ''}</span>
        <span class="ic">${ICON.folder}</span>
        <span class="label">${esc(r.name)}</span>
        <span class="cnt">${r.count}</span>
        <span class="row-edit" data-edit="${esc(r.path)}" title="重命名目录">${ICON.pencil}</span>
      </div>`;
    });
  }

  if (store.state.mode === 'tag') {
    const map = new Map<string, number>();
    live.forEach(n => n.tags.forEach(t => map.set(t, (map.get(t) || 0) + 1)));
    html += '<div class="sec-label">标签</div>';

    ordered([...map.entries()], e => e[0], store.settings.tagOrder,
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .forEach(([t, c]) => {
        const f = store.state.filter;
        const on = !!f && f.type === 'tag' && f.value === t;
        html += `<div class="row ${on ? 'active' : ''}" data-tag="${esc(t)}" data-path="${esc(t)}"
          data-kind="tag" data-parent="" style="${tagStyle(t)}">
          <span class="ic">${ICON.tag}</span>
          <span class="label">${esc(t)}</span>
          <span class="cnt">${c}</span>
          <span class="row-edit" data-edit-tag="${esc(t)}" title="重命名标签">${ICON.pencil}</span>
        </div>`;
      });
  }

  if (store.state.mode === 'group') {
    html += '<div class="sec-label">智能分组</div>';
    groups().forEach(g => {
      const f = store.state.filter;
      const on = !!f && f.type === 'group' && f.value === g.id;
      html += rowHTML(on ? 'active' : '', ICON.group, g.name,
        live.filter(g.match).length, `data-group="${g.id}"`);
    });
  }

  tree.innerHTML = html;

  // 归档 / 废纸篓固定在左栏底部，不随 tab 切换
  const extra = document.getElementById('side-extra');
  if (extra) {
    const isView = (v: string) => {
      const f = store.state.filter;
      return !!f && f.type === 'view' && f.value === v;
    };
    extra.innerHTML = `
      <div class="row ${isView('archive') ? 'active' : ''}" data-view="archive">
        <span class="ic">${ICON.archive}</span><span class="label">归档</span>
        <span class="cnt">${archivedNotes().length}</span>
      </div>
      <div class="row ${isView('hidden') ? 'active' : ''}" data-view="hidden">
        <span class="ic">${ICON.hidden}</span><span class="label">已隐藏</span>
        <span class="cnt">${hiddenNotes().length}</span>
      </div>
      <div class="row ${isView('trash') ? 'active' : ''}" data-view="trash">
        <span class="ic">${ICON.trash}</span><span class="label">废纸篓</span>
        <span class="cnt">${trashedNotes().length}</span>
      </div>`;

    extra.querySelectorAll<HTMLElement>('.row[data-view]').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.dataset.view as 'archive' | 'trash' | 'hidden';
        const on = isView(v);
        store.state.filter = on ? null : { type: 'view', value: v };
        store.state.selectedId = null;
        clearSearch();
        renderAllLeftOnly();
      });
    });
  }

  bindTree(tree);
}

/** 左栏点击只改 filter，重绘交给总线统一触发 */
function renderAllLeftOnly(): void {
  emitChange();
}

/* ============================================================
   拖拽排序
   ============================================================ */

/** 把 moved 从 all 里摘出来，插到 before 之前 / after 之后 */
function reorderRows(all: string[], moved: string, before: string | null, after: string | null): string[] {
  const next = all.filter(p => p !== moved);
  let at = next.length;
  if (before) at = next.indexOf(before);
  else if (after) at = next.indexOf(after) + 1;
  if (at < 0) at = next.length;
  next.splice(at, 0, moved);
  return next;
}

/**
 * 同一个父目录下的行之间拖拽。
 * 只允许在同级之间换位：跨级拖会让目录树结构变得莫名其妙。
 */
function bindDrag(box: HTMLElement): void {
  let drag: {
    row: HTMLElement;
    path: string;
    y0: number;
    moved: boolean;
    target: HTMLElement | null;
    after: boolean;
  } | null = null;

  const rows = (): HTMLElement[] => [...box.querySelectorAll<HTMLElement>('.row[data-path]')];
  const clearMarks = (): void =>
    rows().forEach(r => r.classList.remove('drop-before', 'drop-after'));

  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;

    if (!drag.moved) {
      if (Math.abs(dy) < 7) return;
      drag.moved = true;
      drag.row.classList.add('dragging');
      document.body.classList.add('row-dragging');
    }
    drag.row.style.transform = `translateY(${dy}px)`;

    const sibs = rows().filter(r => r !== drag!.row && r.dataset.parent === drag!.row.dataset.parent);
    clearMarks();
    drag.target = null;
    for (const r of sibs) {
      const b = r.getBoundingClientRect();
      if (e.clientY < b.top + b.height / 2) {
        drag.target = r;
        drag.after = false;
        break;
      }
    }
    if (!drag.target && sibs.length) {
      drag.target = sibs[sibs.length - 1];
      drag.after = true;
    }
    if (drag.target) drag.target.classList.add(drag.after ? 'drop-after' : 'drop-before');
  };

  const onUp = (): void => {
    if (!drag) return;
    const d = drag;
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);

    d.row.classList.remove('dragging');
    d.row.style.transform = '';
    document.body.classList.remove('row-dragging');
    clearMarks();

    if (!d.moved) return;
    rowDragged = true;

    if (!d.target) return;
    const all = rows().map(r => r.dataset.path || '');
    const tp = d.target.dataset.path || '';
    const next = reorderRows(all, d.path, d.after ? null : tp, d.after ? tp : null);

    if (d.row.dataset.kind === 'folder') store.settings.folderOrder = next;
    else store.settings.tagOrder = next;

    saveSettings();
    emitChange();
  };

  rows().forEach(row => {
    row.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      // 铅笔、展开箭头、正在改名的输入框都不算拖拽
      if ((e.target as HTMLElement).closest('.row-edit, .row-rename, [data-chev]')) return;
      drag = { row, path: row.dataset.path || '', y0: e.clientY, moved: false, target: null, after: false };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });
}

function bindTree(tree: HTMLElement): void {
  tree.querySelectorAll<HTMLElement>('.row[data-folder]').forEach(el => {
    el.addEventListener('click', e => {
      if (rowDragged) { rowDragged = false; e.stopPropagation(); return; }
      const chev = (e.target as HTMLElement).closest<HTMLElement>('[data-chev]');
      const path = el.dataset.folder || '';

      if (chev && chev.innerHTML.trim()) {
        e.stopPropagation();
        if (store.state.expanded.has(path)) store.state.expanded.delete(path);
        else store.state.expanded.add(path);
        renderLeft();
        return;
      }

      const f = store.state.filter;
      store.state.filter = (f && f.type === 'folder' && f.value === path)
        ? null
        : { type: 'folder', value: path };
      clearSearch();
      renderAllLeftOnly();
    });
  });

  // 重命名目录：行尾的小铅笔
  tree.querySelectorAll<HTMLElement>('[data-edit]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const row = el.closest<HTMLElement>('.row[data-folder]');
      if (row) {
        const path = row.dataset.folder || '';
        startRename(row, path, next => renameFolder(path, next));
      }
    });
  });

  // 重命名标签：改一处，所有笔记里的这个标签一起改
  tree.querySelectorAll<HTMLElement>('[data-edit-tag]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const row = el.closest<HTMLElement>('.row[data-tag]');
      if (row) {
        const tag = row.dataset.tag || '';
        startRename(row, tag, next => renameTag(tag, next));
      }
    });
  });

  tree.querySelectorAll<HTMLElement>('.row[data-tag]').forEach(el => {
    el.addEventListener('click', e => {
      if (rowDragged) { rowDragged = false; e.stopPropagation(); return; }
      if ((e.target as HTMLElement).closest('.row-edit')) return;
      const t = el.dataset.tag || '';
      const f = store.state.filter;
      store.state.filter = (f && f.type === 'tag' && f.value === t)
        ? null
        : { type: 'tag', value: t };
      clearSearch();
      renderAllLeftOnly();
    });
  });

  tree.querySelectorAll<HTMLElement>('.row[data-group]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.group || '';
      const f = store.state.filter;
      store.state.filter = (f && f.type === 'group' && f.value === id)
        ? null
        : { type: 'group', value: id };
      clearSearch();
      renderAllLeftOnly();
    });
  });

  tree.querySelectorAll<HTMLElement>('.row[data-clear]').forEach(el => {
    el.addEventListener('click', () => {
      store.state.filter = null;
      clearSearch();
      renderAllLeftOnly();
    });
  });

  bindDrag(tree);
}

/** 清空搜索框与状态（右栏高亮由 renderAll 里的 syncEditorSearch 收尾） */
export function clearSearch(): void {
  store.state.search = '';
  const inp = document.getElementById('search') as HTMLInputElement | null;
  if (inp) inp.value = '';
  document.getElementById('search-box')?.classList.remove('has');
}

/* ============================================================
   就地重命名（目录 / 标签共用）
   ============================================================ */

/**
 * 为什么用「铅笔按钮」而不是双击行：
 * 点一下目录行就会切换筛选并立刻重绘整棵树，行元素被换掉了，
 * 第二次点击落在新元素上，dblclick 永远不会触发。
 */
function startRename(
  row: HTMLElement,
  _path: string,
  save: (next: string) => void | Promise<void>
): void {
  const label = row.querySelector<HTMLElement>('.label');
  if (!label || row.querySelector('.row-rename')) return;
  const oldName = label.textContent || '';

  const input = document.createElement('input');
  input.className = 'row-rename';
  input.value = oldName;
  label.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit: boolean): Promise<void> => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (commit && next && next !== oldName) await save(next);
    else emitChange(); // 取消：重绘一下把 label 换回来
  };

  input.addEventListener('keydown', e => {
    e.stopPropagation(); // 别让全局的 Esc / Ctrl+N 抢走
    if (e.key === 'Enter') { e.preventDefault(); void finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); void finish(false); }
  });
  input.addEventListener('blur', () => { void finish(true); });
  // 点输入框不能冒泡到行上，否则会顺手切换筛选
  ['mousedown', 'click', 'dblclick'].forEach(t =>
    input.addEventListener(t, e => e.stopPropagation()));
}
