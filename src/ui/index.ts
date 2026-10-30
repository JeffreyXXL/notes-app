import { store, saveSettings } from '../store';
import { syncTagColors } from '../core/tag-color';
import { renderLeft } from './left';
import { renderMid } from './mid';
import { renderRight, syncEditorSearch, getEditor } from './right';

export function renderAll(): void {
  // 先给标签分好颜色，下面三栏渲染时才能拿到一致的 --th
  syncTagColors(store.notes.flatMap(n => n.tags));
  renderLeft();
  renderMid();
  renderRight();
  syncEditorSearch(false);
}

/* ============================================================
   两栏折叠
   ============================================================ */

function appEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.app');
}

export function applyCollapse(): void {
  const el = appEl();
  if (!el) return;
  el.classList.toggle('no-left', store.settings.leftCollapsed);
  el.classList.toggle('no-mid', store.settings.midCollapsed);
}

export function toggleCol(which: 'left' | 'mid'): void {
  if (which === 'left') store.settings.leftCollapsed = !store.settings.leftCollapsed;
  else store.settings.midCollapsed = !store.settings.midCollapsed;

  saveSettings();
  applyCollapse();

  // 等 grid 过渡结束再让 CodeMirror 重新量宽高
  setTimeout(() => getEditor()?.requestMeasure(), 260);
}
