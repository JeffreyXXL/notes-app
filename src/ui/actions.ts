import {
  noteById, createNote,
  togglePin, toggleArchive, moveToTrash, restoreNote, purgeNote,
  toggleHidden, unhideNote
} from '../store';
import { openMeta } from './meta';
import { focusEditorAtEnd } from './right';

/** 卡片 / 迷你菜单的动作分发：一张表，各分支只调 store */
export async function doAction(act: string, id: string): Promise<void> {
  const n = noteById(id);
  if (!n) return;

  switch (act) {
    case 'pin': togglePin(n); return;
    case 'tag': openMeta(id); return;
    case 'archive': await toggleArchive(n); return;
    case 'hide': await toggleHidden(n); return;
    case 'unhide': await unhideNote(n); return;
    case 'del': await moveToTrash(n); return;
    case 'restore': await restoreNote(n); return;
    case 'purge': await purgeNote(n); return;
    default: return;
  }
}

/** 右键 / 双击 ··· 唤出的迷你菜单 */
export function openActions(id: string): void {
  const n = noteById(id);
  if (!n) return;
  const box = document.getElementById('mini-acts');
  const sheet = document.getElementById('actions');
  if (!box || !sheet) return;

  box.innerHTML = n.trashed
    ? `<div class="mini-row" data-a="restore">恢复</div>
       <div class="mini-row danger" data-a="purge">彻底删除</div>`
    : n.hidden
      ? `<div class="mini-row" data-a="unhide">取消隐藏</div>
         <div class="mini-row danger" data-a="del">删除笔记</div>`
      : `<div class="mini-row" data-a="pin">${n.pinned ? '取消置顶' : '置顶'}</div>
         <div class="mini-row" data-a="archive">${n.archived ? '移出归档' : '归档'}</div>
         <div class="mini-row" data-a="tag">整理目录与标签</div>
         <div class="mini-row" data-a="hide">隐藏这篇笔记</div>
         <div class="mini-row danger" data-a="del">删除笔记</div>`;

  box.querySelectorAll<HTMLElement>('.mini-row').forEach(r => {
    r.addEventListener('click', () => {
      sheet.classList.remove('open');
      void doAction(r.dataset.a || '', id);
    });
  });

  sheet.classList.add('open');
}

/** 新建笔记并聚焦到正文末尾 */
export async function newNote(): Promise<void> {
  await createNote();
  setTimeout(focusEditorAtEnd, 60);
}
