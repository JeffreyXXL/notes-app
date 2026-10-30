import { followLink } from '../store';
import { openExternal } from '../core/open';
import type { LinkKind } from '../editor/live-preview';

/**
 * 正文里点了链接。
 * `[[标题]]` 和 `[文字](路径.md)` 都指向笔记库里的另一篇；
 * `[文字](https://…)` 这种就当外链丢给系统浏览器。
 */
export function openNoteLink(target: string, kind: LinkKind, fromFolder: string): void {
  if (/^(https?:|mailto:)/i.test(target)) {
    openExternal(target);
    return;
  }

  const n = followLink(target, fromFolder);
  if (n) return;

  toast(kind === 'wiki' ? `没有找到「${target}」这篇笔记` : `打不开「${target}」`);
}

/* ============================================================
   轻提示：点空的链接要给个反馈，不然像卡住了
   ============================================================ */

let toastTimer: number | null = null;

export function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el?.classList.remove('show'); }, 1800);
}
