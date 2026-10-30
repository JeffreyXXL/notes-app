import { store, noteById, setNoteContent } from '../store';
import { mount, setSearch, setImageBase } from '../editor';
import type { EditorView } from '../editor';
import { esc, countHits } from '../core/text';
import { formatStamp } from '../core/time';
import { tagStyle } from '../core/tag-color';
import type { Note } from '../types';
import { renderMid } from './mid';
import { quickbarHTML, bindQuickbar } from './quickbar';
import { openNoteLink } from './links';

let editorView: EditorView | null = null;
let editorNote: Note | null = null;
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
}

export function renderRight(): void {
  const col = document.getElementById('right');
  if (!col) return;
  const note = noteById(store.state.selectedId);

  if (!note) {
    destroyEditor();
    col.innerHTML = '<div class="blank"></div>';
    return;
  }

  // 还是同一篇（同一个对象）：只刷新头部，保住光标与滚动位置
  if (editorView && editorNote === note) {
    // 笔记可能被整理弹层挪到别的目录了，图片相对路径的基准要跟着变
    setImageBase(editorView, note.folder);
    const head = col.querySelector('.doc-head');
    if (head) { head.innerHTML = headHTML(note); return; }
  }

  destroyEditor();
  col.innerHTML = `<div class="doc-head">${headHTML(note)}</div>
    <div class="doc-body"><div id="editor-host"></div></div>
    ${quickbarHTML()}`;

  const host = document.getElementById('editor-host');
  if (!host) return;

  editorView = mount(host, note.content, text => {
    setNoteContent(note, text);
    if (midTimer) clearTimeout(midTimer);
    // 打字时不必每个字符都重排列表
    midTimer = window.setTimeout(() => { renderMid(); }, 400);
  }, {
    reveal: store.settings.reveal,
    imageBase: note.folder,
    onLink: (target, kind) => { openNoteLink(target, kind, note.folder); }
  });

  editorNote = note;
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
