/**
 * 编辑区底部的悬浮快捷栏。
 *
 * 常驻显示但不占布局（绝对定位浮在正文上），正文底部本来就留了 180px 空档，
 * 所以不会盖住内容。所有动作都走 editor/commands.ts，和键盘快捷键共用一套实现。
 */

import type { EditorView } from '@codemirror/view';
import {
  toggleWrap, toggleLinePrefix, cycleHeading, insertBlock, insertLink, insertWikiLink,
  TABLE_TEMPLATE
} from '../editor/commands';
import { pickImages } from '../editor/image-insert';

interface Cmd {
  id: string;
  title: string;
  icon: string;
  run: (v: EditorView) => void;
}

const svg = (body: string) =>
  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none">${body}</svg>`;

const stroke = 'stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"';

/** null 表示一根分隔线 */
const CMDS: (Cmd | null)[] = [
  {
    id: 'bold',
    title: '粗体  Ctrl+B',
    icon: svg(`<path d="M4.7 3.1h3.9a2.5 2.5 0 010 5H4.7zM4.7 8.1h4.5a2.6 2.6 0 010 5.2H4.7z" ${stroke}/>`),
    run: v => toggleWrap(v, '**', '**', '粗体')
  },
  {
    id: 'italic',
    title: '斜体  Ctrl+I',
    icon: svg(`<path d="M6.4 3.2h5.2M4.4 12.8h5.2M9.3 3.2L6.7 12.8" ${stroke}/>`),
    run: v => toggleWrap(v, '*', '*', '斜体')
  },
  {
    id: 'strike',
    title: '删除线',
    icon: svg(`<path d="M11.1 5.3C10.6 4.1 9.5 3.4 8 3.4c-1.9 0-3.1 1-3.1 2.3 0 1 .7 1.6 2.2 2l1.8.5c1.6.4 2.4 1 2.4 2.1 0 1.4-1.3 2.3-3.3 2.3-1.7 0-3-.7-3.5-1.9" ${stroke}/><path d="M2.6 8h10.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`),
    run: v => toggleWrap(v, '~~', '~~', '删除线')
  },
  {
    id: 'hl',
    title: '高亮  Ctrl+Shift+H',
    icon: svg(`<rect x="2.6" y="6.2" width="10.8" height="3.6" rx="1.2" fill="currentColor" opacity=".26"/><path d="M4.6 4.4h6.8M4.6 12.2h4.4" ${stroke}/>`),
    run: v => toggleWrap(v, '==', '==', '高亮')
  },
  {
    id: 'code',
    title: '行内代码',
    icon: svg(`<path d="M5.6 4.7L2.3 8l3.3 3.3M10.4 4.7L13.7 8l-3.3 3.3" ${stroke}/>`),
    run: v => toggleWrap(v, '`', '`', '代码')
  },
  {
    id: 'link',
    title: '外链（网址）',
    icon: svg(`<path d="M6.9 9.1a2.5 2.5 0 003.6 0l1.9-1.9a2.5 2.5 0 00-3.6-3.6l-.9.9" ${stroke}/><path d="M9.1 6.9a2.5 2.5 0 00-3.6 0l-1.9 1.9a2.5 2.5 0 003.6 3.6l.9-.9" ${stroke}/>`),
    run: insertLink
  },
  {
    id: 'wikilink',
    title: '链接到另一篇笔记（[[目录/标题]]，可在设置里只写标题）',
    icon: svg(`<path d="M6.4 9.6a2.5 2.5 0 003.6 0l1.4-1.4a2.5 2.5 0 00-3.6-3.6" ${stroke}/><path d="M9.6 6.4a2.5 2.5 0 00-3.6 0L4.6 7.8a2.5 2.5 0 003.6 3.6" ${stroke}/><path d="M2.2 2.2h3M2.2 2.2v3M13.8 13.8h-3M13.8 13.8v-3" ${stroke}/>`),
    run: insertWikiLink
  },

  null,

  {
    id: 'image',
    title: '插入图片（也可以直接粘贴或把文件拖进正文）',
    icon: svg(`<rect x="2.4" y="3.3" width="11.2" height="9.4" rx="2" ${stroke}/><circle cx="5.9" cy="6.5" r="1.1" fill="currentColor"/><path d="M3.3 11.3l2.9-3 2.2 2.2 1.7-1.6 2.6 2.4" ${stroke}/>`),
    run: pickImages
  },
  {
    id: 'h',
    title: '标题（点按循环 H2 → H3 → 正文）',
    icon: svg(`<path d="M4.5 3.4v9.2M11.5 3.4v9.2M4.5 8h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`),
    run: cycleHeading
  },
  {
    id: 'list',
    title: '无序列表',
    icon: svg(`<path d="M6.4 4.5h7M6.4 8h7M6.4 11.5h7" ${stroke}/><circle cx="3.5" cy="4.5" r="1" fill="currentColor"/><circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="3.5" cy="11.5" r="1" fill="currentColor"/>`),
    run: v => toggleLinePrefix(v, '- ')
  },
  {
    id: 'todo',
    title: '待办事项',
    icon: svg(`<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2.4" ${stroke}/><path d="M5.4 8.2l1.8 1.8 3.4-3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`),
    run: v => toggleLinePrefix(v, '- [ ] ')
  },
  {
    id: 'quote',
    title: '引用',
    icon: svg(`<path d="M3.7 3.6v8.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.8 5.3h6.1M6.8 8h6.1M6.8 10.7h4.4" ${stroke}/>`),
    run: v => toggleLinePrefix(v, '> ')
  },
  {
    id: 'table',
    title: '插入表格',
    icon: svg(`<rect x="2.5" y="3.4" width="11" height="9.2" rx="1.6" ${stroke}/><path d="M2.5 6.6h11M6.6 6.6v6M10 6.6v6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>`),
    run: v => insertBlock(v, TABLE_TEMPLATE)
  },
  {
    id: 'hr',
    title: '分隔线',
    icon: svg(`<path d="M2.6 8h10.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4.8 5.1h6.4M4.8 10.9h6.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".45"/>`),
    run: v => insertBlock(v, '---')
  }
];

export function quickbarHTML(): string {
  const body = CMDS
    .map(c => c
      ? `<button class="qb-btn" data-qb="${c.id}" title="${c.title}" aria-label="${c.title}">${c.icon}</button>`
      : '<span class="qb-sep"></span>')
    .join('');
  return `<div class="quickbar" id="quickbar">${body}</div>`;
}

export function bindQuickbar(view: EditorView): void {
  const bar = document.getElementById('quickbar');
  if (!bar) return;

  // 按下就阻止默认：否则编辑器失焦，光标行会闪一下变回渲染态
  bar.addEventListener('mousedown', e => e.preventDefault());

  bar.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-qb]') as HTMLElement | null;
    if (!btn) return;
    const cmd = CMDS.find(c => c && c.id === btn.dataset.qb);
    cmd?.run(view);
  });
}
