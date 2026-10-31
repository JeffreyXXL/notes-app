import { store, noteById, setNoteContent } from '../store';
import { mount, setSearch, setImageBase } from '../editor';
import type { EditorView } from '../editor';
import { Transaction } from '@codemirror/state';
import { esc, countHits } from '../core/text';
import { formatStamp } from '../core/time';
import { tagStyle } from '../core/tag-color';
import type { Note } from '../types';
import { renderMid } from './mid';
import { quickbarHTML, bindQuickbar } from './quickbar';
import { openNoteLink } from './links';

let editorView: EditorView | null = null;
let editorNote: Note | null = null;
/**
 * 当前编辑器对应的笔记 id（相对路径）。
 *
 * 为什么要单独存一份：`reload()` 是重新读盘、重新构造一批 Note 对象，
 * 切回窗口（visibilitychange）就会走一次。这时 selectedId 没变、路径没变，
 * 但对象换了新的 —— 只比对象身份会误判成「换了一篇」，把编辑器拆了重建，
 * 滚动位置和光标就跟着回到文章开头。
 */
let editorKey: string | null = null;
let midTimer: number | null = null;

export function getEditor(): EditorView | null {
  return editorView;
}

export function docHintText(): string {
  const q = store.state.search.trim();
  if (!q) return '';
  const n = noteById(store.state.selectedId);
  const c = n ? countHits(n.content, q) : 0;
  // 0 处匹配时不显示徽标
  return c ? `搜索「${q}」· ${c} 处匹配` : '';
}

function headHTML(note: Note): string {
  const hint = docHintText();
  const tags = note.tags
    .map(t => `<span class="pill tag" style="${tagStyle(t)}">${esc(t)}</span>`).join(' ');
  return `
    <span class="crumb">${esc(note.folder.replace(/\//g, ' / '))}</span>
    <span>·</span><span>${esc(formatStamp(note.updated))}</span>
    <span class="grow"></span>
    ${tags}
    <span class="hint${hint ? ' hit' : ''}" id="doc-hint">${esc(hint)}</span>`;
}

function destroyEditor(): void {
  if (midTimer) { clearTimeout(midTimer); midTimer = null; }
  if (editorView) { editorView.destroy(); editorView = null; }
  editorNote = null;
  editorKey = null;
}

/**
 * 把磁盘上的正文同步进已经打开的视图。
 *
 * 只有 reload 之后内容真的变了才走这里（同步盘、别的编辑器改过）。
 * 直接整篇替换而不重建视图，是为了保住滚动位置和光标 —— 用户切回窗口
 * 只是想接着看，不是想回到文章开头。
 */
function syncDoc(note: Note): void {
  const view = editorView;
  if (!view) return;
  const next = note.content;
  if (view.state.doc.toString() === next) return;

  const scroller = view.scrollDOM;
  const top = scroller.scrollTop;
  const head = view.state.selection.main.head;

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
    selection: { anchor: Math.min(head, next.length) },
    // 外部改动不进撤销栈：不然 Ctrl+Z 会把磁盘上的新内容撤回去，反手写盘覆盖掉
    annotations: Transaction.addToHistory.of(false)
  });

  scroller.scrollTop = top;
  // 文档高度变了要重新量一次，下一帧再落回去才不会被测量过程带偏
  requestAnimationFrame(() => { scroller.scrollTop = top; });
}

export function renderRight(): void {
  const col = document.getElementById('right');
  if (!col) return;
  const note = noteById(store.state.selectedId);

  if (!note) {
    destroyEditor();
    // 顶部留一条和正文头等高的空条。不选笔记时右栏只剩一块铺满的空白，
    // 那条空条是窗口顶部唯一的拖动把手 —— 少了它，第一次打开应用
    // 只有左栏左上角那一小块能拖窗口。
    col.innerHTML = '<div class="doc-head doc-head-blank"></div><div class="blank"></div>';
    return;
  }

  // 还是同一篇：只刷新头部，保住光标与滚动位置。
  // 两种认法缺一不可 —— 对象身份管「按标题改名」（对象没换、路径变了），
  // id 管 reload（路径没变、对象换了一批新的）
  if (editorView && (editorNote === note || editorKey === note.id)) {
    editorKey = note.id;
    editorNote = note;
    // 笔记可能被整理弹层挪到别的目录了，图片相对路径的基准要跟着变
    setImageBase(editorView, note.folder);
    syncDoc(note);
    const head = col.querySelector('.doc-head');
    if (head) { head.innerHTML = headHTML(note); return; }
  }

  // 同一篇却还是得重建（视图被拆过）：把滚动位置带过去。
  // 换到另一篇时从顶部开始，那是用户预期
  const keepTop = editorKey === note.id && editorView ? editorView.scrollDOM.scrollTop : 0;

  destroyEditor();
  col.innerHTML = `<div class="doc-head">${headHTML(note)}</div>
    <div class="doc-body"><div id="editor-host"></div></div>
    ${quickbarHTML()}`;

  const host = document.getElementById('editor-host');
  if (!host) return;

  editorView = mount(host, note.content, text => {
    // 回调里不能直接用闭包里的 note：reload 之后 store 里已经是新对象了，
    // 写旧对象会让标题、待办计数一直停在 reload 之前的样子
    const cur = noteById(note.id) ?? note;
    setNoteContent(cur, text);
    if (midTimer) clearTimeout(midTimer);
    // 打字时不必每个字符都重排列表
    midTimer = window.setTimeout(() => { renderMid(); }, 400);
  }, {
    reveal: store.settings.reveal,
    imageBase: note.folder,
    onLink: (target, kind) => {
      openNoteLink(target, kind, noteById(note.id)?.folder ?? note.folder);
    }
  });

  editorNote = note;
  editorKey = note.id;
  if (keepTop) editorView.scrollDOM.scrollTop = keepTop;
  setSearch(editorView, store.state.search.trim(), true);
  bindQuickbar(editorView);
}

/** 搜索词变化时同步右栏高亮（不重建编辑器） */
export function syncEditorSearch(scroll: boolean): void {
  if (editorView) setSearch(editorView, store.state.search.trim(), !!scroll);
  const h = document.getElementById('doc-hint');
  if (h) {
    const t = docHintText();
    h.textContent = t;
    h.classList.toggle('hit', !!t);
  }
}

export function focusEditorAtEnd(): void {
  if (!editorView) return;
  editorView.focus();
  const end = editorView.state.doc.length;
  editorView.dispatch({ selection: { anchor: end } });
}
