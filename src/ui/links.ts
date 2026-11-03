import { followLink } from '../store';
import { openExternal } from '../core/open';
import { toast } from '../core/toast';
import type { LinkKind } from '../editor/live-preview';

// 以前 toast 就住在这个文件里，设置面板等处一直是 `from './links'` 引的，
// 挪到 core 之后在这里转出去，免得再改一遍所有调用点
export { toast };

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
   （实现在 core/toast，这里只是转出去）
   ============================================================ */
