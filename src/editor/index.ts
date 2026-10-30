import {
  EditorView, drawSelection, keymap, placeholder
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  revealField, setRevealEffect, setSearchEffect, searchField,
  livePreviewPlugin, hitPlugin, tableBlocksField, tableField,
  imageBaseField, imageBlocksField, imageField, setImageBaseEffect,
  selectedImageField, imageSelectPlugin,
  codeBlocksField, codeField, linkPlugin, setLinkHandler
} from './live-preview';
import type { LinkKind } from './live-preview';
import { toggleWrap, continueMarkup } from './commands';
import { insertImages, imageFilesFrom } from './image-insert';

export type { EditorView } from '@codemirror/view';

/**
 * 只保留布局相关的内联样式。
 * 颜色全部交给 CSS 变量，这样亮/暗主题切换不用重建编辑器。
 */
const layoutTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { fontFamily: 'inherit', overflowY: 'auto', overflowX: 'hidden' },
  '.cm-content': {
    padding: '44px 56px 180px',
    maxWidth: '842px',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftWidth: '1.5px' }
});

export interface MountOptions {
  reveal?: boolean;
  /** 笔记所在目录，用来解析正文里手写的相对图片路径 */
  imageBase?: string;
  /** 点了正文里的笔记链接。target 是 `[[x]]` 里的 x，或 `[t](x)` 里的 x */
  onLink?: (target: string, kind: LinkKind) => void;
}

/* ============================================================
   粘贴 / 拖拽图片
   ============================================================ */

/**
 * 剪贴板里的截图和从资源管理器拖进来的图，直接存进笔记库再插入。
 * 返回 true 表示这个事件已经被接管 —— CodeMirror 的默认粘贴/拖放
 * 会把图片当成乱码文本或者干脆什么都不做，必须自己拦下来。
 */
const imageDropHandlers = EditorView.domEventHandlers({
  paste(e, view) {
    const files = imageFilesFrom(e.clipboardData);
    if (!files.length) return false;
    e.preventDefault();
    void insertImages(view, files, view.state.selection.main.to);
    return true;
  },
  // 没有这一步浏览器根本不会派发 drop 事件
  dragover(e) {
    const types = e.dataTransfer?.types;
    if (!types || !Array.from(types).includes('Files')) return false;
    e.preventDefault();
    return true;
  },
  drop(e, view) {
    const files = imageFilesFrom(e.dataTransfer);
    if (!files.length) return false;
    e.preventDefault();
    // 落点就是鼠标位置，不是当前光标
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    void insertImages(view, files, pos ?? view.state.selection.main.to);
    return true;
  }
});

export function mount(
  parent: HTMLElement,
  doc: string,
  onChange: (text: string) => void,
  opts: MountOptions = {}
): EditorView {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        revealField,
        drawSelection(),
        EditorView.lineWrapping,
        keymap.of([
          // 自定义的要排在 defaultKeymap 前面，不然会被默认键位抢先匹配
          { key: 'Mod-b', run: v => { toggleWrap(v, '**', '**', '粗体'); return true; } },
          { key: 'Mod-i', run: v => { toggleWrap(v, '*', '*', '斜体'); return true; } },
          // 回车续格式：待办 / 列表 / 引用。不归它管时返回 false，
          // 继续落到下面的 insertNewlineAndIndent
          { key: 'Enter', run: continueMarkup },
          ...defaultKeymap,
          ...historyKeymap
        ]),
        placeholder('开始写点什么…'),
        // 顺序不能换：tableField 依赖 tableBlocksField，imageField 依赖另外三个
        tableBlocksField,
        tableField,
        codeBlocksField,
        codeField,
        imageBaseField,
        imageBlocksField,
        selectedImageField,
        imageField,
        livePreviewPlugin,
        imageSelectPlugin,
        linkPlugin,
        searchField,
        hitPlugin,
        imageDropHandlers,
        layoutTheme,
        EditorView.updateListener.of(u => {
          if (u.docChanged) onChange(u.state.doc.toString());
        })
      ]
    })
  });

  if (opts.reveal === false) view.dispatch({ effects: setRevealEffect.of(false) });
  if (opts.imageBase) view.dispatch({ effects: setImageBaseEffect.of(opts.imageBase) });
  setLinkHandler(opts.onLink ?? null);
  return view;
}

export function setReveal(view: EditorView | null, on: boolean): void {
  if (view) view.dispatch({ effects: setRevealEffect.of(!!on) });
}

/** 笔记被移动到别的目录后，同步图片相对路径的解析基准 */
export function setImageBase(view: EditorView | null, base: string): void {
  if (!view) return;
  if (view.state.field(imageBaseField) === base) return;
  view.dispatch({ effects: setImageBaseEffect.of(base) });
}

function scrollToHit(view: EditorView, q: string): void {
  const hay = view.state.doc.toString().toLowerCase();
  const i = hay.indexOf(q.toLowerCase());
  if (i < 0) return;
  view.dispatch({ effects: EditorView.scrollIntoView(i, { y: 'center' }) });
}

export function setSearch(view: EditorView | null, q: string, scroll: boolean): void {
  if (!view) return;
  const next = q || '';
  if (view.state.field(searchField) !== next) {
    view.dispatch({ effects: setSearchEffect.of(next) });
  }
  if (scroll && next) scrollToHit(view, next);
}
