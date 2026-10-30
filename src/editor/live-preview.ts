import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Range } from '@codemirror/state';
import { esc } from '../core/text';
import { assetUrl } from '../core/image';
import { highlight, langOf } from './highlight';

/* ============================================================
   状态字段：光标行是否露出 Markdown 源码 / 当前搜索词
   ============================================================ */

export const setRevealEffect = StateEffect.define<boolean>();

export const revealField = StateField.define<boolean>({
  create: () => true,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setRevealEffect)) return e.value;
    return v;
  }
});

export const setSearchEffect = StateEffect.define<string>();

export const searchField = StateField.define<string>({
  create: () => '',
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setSearchEffect)) return e.value;
    return v;
  }
});

/* ============================================================
   小部件：列表符号 / 待办复选框
   ============================================================ */

class MarkerWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string) { super(); }
  override eq(o: MarkerWidget): boolean { return o.text === this.text && o.cls === this.cls; }
  override toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = this.cls;
    s.textContent = this.text;
    return s;
  }
  override ignoreEvent(): boolean { return true; }
}

class TodoWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  override eq(o: TodoWidget): boolean { return o.checked === this.checked && o.pos === this.pos; }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-todo';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'todo-box';
    box.checked = this.checked;
    box.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    box.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.pos;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    wrap.appendChild(box);
    return wrap;
  }
  override ignoreEvent(): boolean { return true; }
}

/**
 * 待办行尾的小「＋」：给这一条补一个解决方式。
 * 只在还没写解决方式时出现，鼠标移到这一行才显形，平时不占注意力。
 */
class TodoNoteWidget extends WidgetType {
  constructor(readonly pos: number) { super(); }
  override eq(o: TodoNoteWidget): boolean { return o.pos === this.pos; }

  override toDOM(view: EditorView): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-todonote-add';
    b.title = '写解决方式（也可以直接写 [[另一篇笔记]]）';
    b.textContent = '＋';
    ['mousedown', 'mouseup', 'click'].forEach(t =>
      b.addEventListener(t, e => e.stopPropagation()));
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => {
      e.preventDefault();
      const p = Math.min(this.pos, view.state.doc.length);
      view.dispatch({
        changes: { from: p, insert: ' → ' },
        selection: { anchor: p + 3 }
      });
      view.focus();
    });
    return b;
  }
  override ignoreEvent(): boolean { return true; }
}

/* ============================================================
   表格
   ============================================================ */

/** 围栏行：```ts / ~~~。代码块、表格、图片都要用它判断「这行在不在代码里」 */
const FENCE_RE = /^\s*(```+|~~~+)\s*(.*)$/;

/**
 * 哪些行属于围栏代码块（含围栏行本身）。
 * 表格 / 图片都要跳过这些行：代码块已经整块换成 widget 了，
 * 再往里塞一个表格或图片的 replace 装饰会重叠，CodeMirror 直接报错。
 */
function fenceMask(state: EditorState): Uint8Array {
  const doc = state.doc;
  const mask = new Uint8Array(doc.lines + 2);
  let inside = false;
  for (let i = 1; i <= doc.lines; i++) {
    if (FENCE_RE.test(doc.line(i).text)) { mask[i] = 1; inside = !inside; }
    else if (inside) mask[i] = 1;
  }
  return mask;
}

type Align = 'l' | 'c' | 'r';

/** 一行是不是表格行：`| a | b |` 或 `a | b` */
function isTableRow(text: string): boolean {
  const t = text.trim();
  if (!t.includes('|')) return false;
  return t.startsWith('|') || /^[^|]*\|[^|]*$/.test(t);
}

/** 分隔行：`| --- | :--: |` */
function isTableSep(text: string): boolean {
  const t = text.trim();
  if (!t.includes('-')) return false;
  return /^\|?[\s:|-]+\|?$/.test(t) && /-/.test(t);
}

function splitRow(text: string): string[] {
  let s = text.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  if (left && right) return 'c';
  if (right) return 'r';
  return 'l';
}

/** 单元格内的行内标记。先整体转义，再把标记换回标签，避免标签被二次转义 */
function cellHtml(s: string): string {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  h = h.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text, href) =>
    /^(https?:|mailto:|#)/i.test(href) ? `<a href="${href}">${text}</a>` : all);
  return h;
}

/* ============================================================
   表格 / 图片共用的交互：单击进块
   ============================================================ */

/**
 * 单击（而不是拖选文字）把光标放进块里，块随即变回源码好编辑。
 * 拖选时不跳，否则块里的文字就没法复制了。
 */
function clickToEdit(el: HTMLElement, view: EditorView, pos: number): void {
  let down: { x: number; y: number } | null = null;
  el.addEventListener('mousedown', e => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('mouseup', e => {
    const from = down;
    down = null;
    if (!from) return;
    if (Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > 4) return;
    e.preventDefault();
    view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
    view.focus();
  });
}

/**
 * 双击才进源码 —— 和图片一致。
 *
 * 早先代码块是单击就跳回源码：想滚一下、想挑个词复制、或者只是点偏了，
 * 整块「啪」地散成一堆围栏，还得再点回去。所以单击改成什么都不做。
 *
 * 关键在 mousedown 上：CodeMirror 自己的 mousedown 挂在 contentDOM 上，
 * 不拦住它，光标会先被塞进块里 —— 而「光标在块内」正是露出源码的条件，
 * 拦得再晚也没用（图片那边踩的是同一个坑）。
 */
function dblClickToEdit(el: HTMLElement, view: EditorView, pos: number): void {
  // 头部的「复制」按钮自己处理事件，别在这儿被吃掉
  const onChrome = (t: EventTarget | null): boolean =>
    !!(t as HTMLElement | null)?.closest?.('.cb-copy');

  el.addEventListener('mousedown', e => {
    if (onChrome(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  });

  el.addEventListener('dblclick', e => {
    if (onChrome(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
    view.focus();
  });
}

class TableWidget extends WidgetType {
  constructor(
    readonly head: string[],
    readonly body: string[][],
    readonly aligns: Align[],
    readonly pos: number
  ) { super(); }
  override eq(o: TableWidget): boolean {
    return this.pos === o.pos
      && JSON.stringify([this.head, this.body, this.aligns]) === JSON.stringify([o.head, o.body, o.aligns]);
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-table';
    const table = document.createElement('table');
    const al = (i: number) => this.aligns[i] || 'l';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    this.head.forEach((c, i) => {
      const th = document.createElement('th');
      th.className = 'ta-' + al(i);
      th.innerHTML = cellHtml(c);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    if (this.body.length) {
      const tbody = document.createElement('tbody');
      for (const row of this.body) {
        const tr = document.createElement('tr');
        // 按表头列数补齐 / 截断，避免参差
        for (let i = 0; i < this.head.length; i++) {
          const td = document.createElement('td');
          td.className = 'ta-' + al(i);
          td.innerHTML = cellHtml(row[i] ?? '');
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }

    wrap.appendChild(table);
    clickToEdit(wrap, view, this.pos);

    return wrap;
  }
  // 自己处理鼠标事件，不让 CodeMirror 把点击解析到块外面去
  override ignoreEvent(): boolean { return false; }
}

/* ============================================================
   表格块：整块替换必须由 StateField 提供
   CodeMirror 的 block 级 replace 装饰不允许来自 ViewPlugin，
   所以表格单独放一个 StateField，ViewPlugin 只管光标在块内时的源码样式。
   ============================================================ */

interface TableBlock { s: number; e: number; head: string[]; body: string[][]; aligns: Align[]; }

function collectTables(state: EditorState): TableBlock[] {
  const doc = state.doc;
  const out: TableBlock[] = [];
  const fence = fenceMask(state);
  for (let i = 1; i <= doc.lines; i++) {
    if (fence[i]) continue;
    if (!isTableRow(doc.line(i).text)) continue;
    // 只在块首处理，块内其余行跳过
    if (i > 1 && isTableRow(doc.line(i - 1).text)) continue;

    let e = i;
    while (e < doc.lines && isTableRow(doc.line(e + 1).text)) e++;
    const sepLine = i + 1;
    // 至少要「表头 + 分隔 + 一行数据」
    if (!(sepLine <= e && isTableSep(doc.line(sepLine).text) && e - i >= 2)) continue;

    const head = splitRow(doc.line(i).text);
    const aligns = splitRow(doc.line(sepLine).text).map(alignOf);
    const body: string[][] = [];
    for (let k = sepLine + 1; k <= e; k++) body.push(splitRow(doc.line(k).text));
    out.push({ s: i, e, head, body, aligns });
    i = e;
  }
  return out;
}

/** 表格块列表随文档变化重算一次，供 StateField 与 ViewPlugin 共用 */
export const tableBlocksField = StateField.define<TableBlock[]>({
  create: state => collectTables(state),
  update(v, tr) { return tr.docChanged ? collectTables(tr.state) : v; }
});

function buildTables(state: EditorState): DecorationSet {
  const doc = state.doc;
  if (!doc.toString().includes('|')) return Decoration.none;

  const sel = state.selection.main;
  const aFrom = doc.lineAt(sel.from).number;
  const aTo = doc.lineAt(sel.to).number;
  const out: Range<Decoration>[] = [];

  for (const b of state.field(tableBlocksField)) {
    // 光标在块内：露出源码好编辑
    if (aFrom <= b.e && aTo >= b.s) continue;
    const from = doc.line(b.s).from;
    out.push(Decoration.replace({
      widget: new TableWidget(b.head, b.body, b.aligns, from),
      block: true
    }).range(from, doc.line(b.e).to));
  }
  return out.length ? Decoration.set(out, true) : Decoration.none;
}

export const tableField = StateField.define<DecorationSet>({
  create: state => buildTables(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildTables(tr.state);
    return deco;
  },
  provide: f => EditorView.decorations.from(f)
});

/* ============================================================
   代码块
   ============================================================ */

/**
 * 围栏代码块整块渲染成 <pre><code>，带语言标签和复制按钮。
 *
 * 以前是「把两行围栏藏起来、中间每行加个底色」的做法，问题在于：
 *   1. 藏起来的围栏行还占着一行高度，块上下各有一条空条；
 *   2. 拖选跨过代码块时，被隐藏的围栏仍参与选区计算，
 *      选区会画在空白处，看着像选区错位。
 * 整块换成 widget 后这两个问题一起消失，顺带还能做语法高亮。
 */

interface CodeBlock { s: number; e: number; lang: string; code: string; }

function collectCode(state: EditorState): CodeBlock[] {
  const doc = state.doc;
  const out: CodeBlock[] = [];

  for (let i = 1; i <= doc.lines; i++) {
    const m = FENCE_RE.exec(doc.line(i).text);
    if (!m) continue;

    const close = m[1][0] === '`' ? /^\s*```+/ : /^\s*~~~+/;
    let e = -1;
    for (let k = i + 1; k <= doc.lines; k++) {
      if (close.test(doc.line(k).text)) { e = k; break; }
    }
    // 没写收尾围栏就不渲染，保持源码 —— 正在写的块不该突然变成成品
    if (e < 0) break;

    const lines: string[] = [];
    for (let k = i + 1; k < e; k++) lines.push(doc.line(k).text);
    out.push({ s: i, e, lang: langOf(m[2]), code: lines.join('\n') });
    i = e;
  }
  return out;
}

export const codeBlocksField = StateField.define<CodeBlock[]>({
  create: state => collectCode(state),
  update(v, tr) { return tr.docChanged ? collectCode(tr.state) : v; }
});

class CodeWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly lang: string,
    readonly pos: number
  ) { super(); }

  override eq(o: CodeWidget): boolean {
    return o.code === this.code && o.lang === this.lang && o.pos === this.pos;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-codeblock';

    const head = document.createElement('div');
    head.className = 'cb-head';

    const tag = document.createElement('span');
    tag.className = 'cb-lang';
    tag.textContent = this.lang || 'text';
    head.appendChild(tag);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cb-copy';
    copy.textContent = '复制';
    // 这三个都要拦：clickToEdit 挂在 wrap 上，不拦会把光标送进代码块
    ['mousedown', 'mouseup', 'click'].forEach(t =>
      copy.addEventListener(t, e => e.stopPropagation()));
    copy.addEventListener('mousedown', e => e.preventDefault());
    copy.addEventListener('click', e => {
      e.preventDefault();
      void this.doCopy(copy);
    });
    head.appendChild(copy);
    wrap.appendChild(head);

    const pre = document.createElement('pre');
    // 单击不动它，得让人知道怎么进去（只挂在代码区，别盖到「复制」按钮上）
    pre.title = '双击编辑';
    const code = document.createElement('code');
    code.className = 'cb-code';
    code.innerHTML = highlight(this.code, this.lang);
    pre.appendChild(code);
    wrap.appendChild(pre);

    dblClickToEdit(wrap, view, this.pos);
    return wrap;
  }

  private async doCopy(btn: HTMLElement): Promise<void> {
    const old = btn.textContent;
    try {
      await navigator.clipboard.writeText(this.code);
      btn.textContent = '已复制';
    } catch {
      btn.textContent = '复制失败';
    }
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  // 自己处理鼠标事件，不让 CodeMirror 把点击解析到块外面去
  override ignoreEvent(): boolean { return false; }
}

function buildCode(state: EditorState): DecorationSet {
  const blocks = state.field(codeBlocksField);
  if (!blocks.length) return Decoration.none;

  const doc = state.doc;
  // 只看「光标在哪一行」而不是选区范围：拖选跨过代码块时，
  // 用范围判断会让块在拖到一半时突然展开，整页重排，手一抖就选歪了
  const headLine = doc.lineAt(state.selection.main.head).number;
  const out: Range<Decoration>[] = [];

  for (const b of blocks) {
    if (headLine >= b.s && headLine <= b.e) continue;
    const from = doc.line(b.s).from;
    out.push(Decoration.replace({
      widget: new CodeWidget(b.code, b.lang, from),
      block: true
    }).range(from, doc.line(b.e).to));
  }
  return out.length ? Decoration.set(out, true) : Decoration.none;
}

export const codeField = StateField.define<DecorationSet>({
  create: state => buildCode(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildCode(tr.state);
    return deco;
  },
  provide: f => EditorView.decorations.from(f)
});

/* ============================================================
   图片
   ============================================================ */

/**
 * 单独成行的 `![alt](path)` 才算图片块；夹在句子中间的保持原样。
 * 末尾可以再跟一个 `{width=320}` 指定显示宽度（见 withImageWidth）。
 */
function parseImageLine(text: string): { alt: string; src: string; width: string } | null {
  // 路径允许 `<带空格 的路径>` 的写法，也允许后面跟一个 title
  const m = /^\s*!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^()\s]+))(?:\s+["'][^"']*["'])?\s*\)\s*(?:\{([^}]*)\})?\s*$/
    .exec(text);
  if (!m) return null;
  const src = (m[2] || m[3] || '').trim();
  if (!src) return null;
  return { alt: m[1] || '', src, width: widthOf(m[4] || '') };
}

/**
 * 从 `{width=320 height=200}` 里挑出宽度。支持 `320` / `320px` / `50%`。
 * 认不出就返回空串，等于「原始大小」。
 */
function widthOf(attrs: string): string {
  const m = /(?:^|[\s,])(?:width|w)\s*=\s*"?([0-9.]+(?:px|%)?)"?/i.exec(attrs);
  if (!m) return '';
  const v = m[1].toLowerCase();
  if (v.endsWith('%')) return v;
  const n = Math.round(parseFloat(v));
  return n > 0 ? String(n) : '';
}

/** `320` → `320px`，`50%` → `50%` */
function widthCss(w: string): string {
  if (!w) return '';
  return w.endsWith('%') ? w : w + 'px';
}

/** 把宽度写回一行 markdown。原来有 `{...}` 就改里面的 width，没有就在行尾补一个 */
export function withImageWidth(lineText: string, w: string): string {
  const t = lineText.replace(/\s+$/, '');
  const m = /\{([^{}]*)\}\s*$/.exec(t);
  // 其它属性（height / class 之类）原样留着，只动 width
  const keep = m
    ? m[1].split(/[\s,]+/).filter(Boolean).filter(a => !/^(?:width|w)\s*=/i.test(a))
    : [];
  const attrs = w ? [...keep, `width=${w}`] : keep;
  const head = (m ? t.slice(0, m.index) : t).replace(/\s+$/, '');
  return attrs.length ? `${head}{${attrs.join(' ')}}` : head;
}

interface ImageBlock { s: number; alt: string; src: string; width: string; }

/**
 * 当前笔记所在的目录。
 * 只用来解析用户手写的相对路径（`./img.png`）；自己插入的 `_assets/xxx.png`
 * 是库内绝对路径，跟这个值无关，所以移动笔记不会让图片失效。
 */
export const setImageBaseEffect = StateEffect.define<string>();

export const imageBaseField = StateField.define<string>({
  create: () => '',
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setImageBaseEffect)) return e.value;
    return v;
  }
});

/**
 * 当前选中的图片（存它的行首位置，-1 表示没选）。
 *
 * 为什么选中态要放在 state 里而不是 DOM 上：改宽度会改文档 → 整个 widget
 * 重建 → 原来那个 DOM 连同它的 class 一起没了。放在 state 里，重建后还是选中态，
 * 用户可以接着拖第二次。
 */
export const setSelectedImageEffect = StateEffect.define<number>();

export const selectedImageField = StateField.define<number>({
  create: () => -1,
  update(v, tr) {
    let next = v;
    let explicit = false;
    for (const e of tr.effects) {
      if (e.is(setSelectedImageEffect)) { next = e.value; explicit = true; }
    }
    // 文档变了但没显式指定：位置跟着映射过去（改宽度是在行内改，行首不会动）
    if (tr.docChanged && !explicit && next >= 0) next = tr.changes.mapPos(next);
    return next;
  }
});

function collectImages(state: EditorState): ImageBlock[] {
  const doc = state.doc;
  if (!doc.toString().includes('![')) return [];

  const out: ImageBlock[] = [];
  const fence = fenceMask(state);
  for (let i = 1; i <= doc.lines; i++) {
    if (fence[i]) continue;
    const p = parseImageLine(doc.line(i).text);
    if (p) out.push({ s: i, alt: p.alt, src: p.src, width: p.width });
  }
  return out;
}

export const imageBlocksField = StateField.define<ImageBlock[]>({
  create: state => collectImages(state),
  update(v, tr) { return tr.docChanged ? collectImages(tr.state) : v; }
});

/**
 * 一张渲染态的图。
 *
 * 交互分三档，别再退回去「点一下就变源码」：
 * - 单击 → 选中（外圈描边 + 右上角工具条 + 右下角拖拽把手）
 * - 双击 → 光标进到这一行，露出 `![alt](path)` 源码改路径
 * - 拖右下角把手 → 改宽度，松手才写文档
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly base: string,
    readonly pos: number,
    readonly width: string,
    readonly selected: boolean
  ) { super(); }

  override eq(o: ImageWidget): boolean {
    return o.src === this.src && o.alt === this.alt && o.base === this.base
      && o.pos === this.pos && o.width === this.width && o.selected === this.selected;
  }

  override toDOM(view: EditorView): HTMLElement {
    const fig = document.createElement('figure');
    fig.className = 'cm-img' + (this.selected ? ' selected' : '');

    const url = assetUrl(this.src, this.base);
    if (!url) {
      this.showMissing(fig, `找不到图片：${this.src}`);
      return fig;
    }

    // 图片外面再包一层，工具条和把手才贴得住图片的边。
    // 直接挂在 figure 上的话，图比正文窄时工具条会飘到整列的最右边去。
    const frame = document.createElement('div');
    frame.className = 'img-frame';

    const img = document.createElement('img');
    img.alt = this.alt;
    img.src = url;
    img.draggable = false;
    // 宽度放在 frame 上、img 撑满：这样百分比是相对正文宽度算的，
    // 窗口变窄时图会跟着缩，而不是溢出
    if (this.width) {
      frame.style.width = widthCss(this.width);
      img.style.width = '100%';
    }
    // 文件被删了 / 路径写错了，只留一个破图标太难看，换成一行能读的提示
    img.addEventListener('error', () => {
      img.remove();
      this.showMissing(fig, `找不到图片：${this.src}`);
    });
    frame.appendChild(img);
    fig.appendChild(frame);

    this.wire(fig, img, view);
    if (this.selected) this.buildChrome(frame, fig, img, view);

    return fig;
  }

  /* ---- 鼠标：单击选中、双击进源码 ---- */

  private wire(fig: HTMLElement, img: HTMLImageElement, view: EditorView): void {
    // 工具条和把手自己处理，别在这里被当成「点图片」
    const onChrome = (t: EventTarget | null): boolean =>
      !!(t as HTMLElement | null)?.closest?.('.img-tools, .img-grip');

    let down: { x: number; y: number } | null = null;

    // 关键：图片自己吃掉 mousedown。不然 CodeMirror 会把光标挪进这一行，
    // 而「光标在图片行」正是露出源码的条件 —— 这就是以前「点一下就变文字」的来路。
    fig.addEventListener('mousedown', e => {
      if (onChrome(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      down = { x: e.clientX, y: e.clientY };
    });

    fig.addEventListener('mouseup', e => {
      if (onChrome(e.target)) return;
      const from = down;
      down = null;
      if (!from) return;
      e.preventDefault();
      e.stopPropagation();
      // 拖了一下（想选图里的东西）就不算单击
      if (Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > 4) return;
      this.select(view);
    });

    fig.addEventListener('dblclick', e => {
      if (onChrome(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      this.edit(view);
    });

    img.addEventListener('dragstart', e => e.preventDefault());
  }

  private select(view: EditorView): void {
    if (view.state.field(selectedImageField) === this.pos) return;
    view.dispatch({ effects: setSelectedImageEffect.of(this.pos) });
  }

  private edit(view: EditorView): void {
    const pos = Math.min(this.pos, view.state.doc.length);
    view.dispatch({
      selection: { anchor: pos },
      effects: setSelectedImageEffect.of(-1)
    });
    view.focus();
  }

  /* ---- 选中态：尺寸工具条 + 拖拽把手 ---- */

  private buildChrome(
    frame: HTMLElement,
    fig: HTMLElement,
    img: HTMLImageElement,
    view: EditorView
  ): void {
    const bar = document.createElement('div');
    bar.className = 'img-tools';

    const label = document.createElement('span');
    label.className = 'img-size';
    label.textContent = this.width ? widthCss(this.width) : '原始大小';
    bar.appendChild(label);

    // 百分比相对正文宽度，窗口变窄时会跟着缩
    for (const p of ['25%', '50%', '75%', '100%']) {
      bar.appendChild(this.toolButton(p, this.width === p, () => this.commit(view, p)));
    }
    bar.appendChild(this.toolButton('原始', !this.width, () => this.commit(view, '')));

    const sep = document.createElement('span');
    sep.className = 'img-sep';
    bar.appendChild(sep);

    bar.appendChild(this.toolButton('编辑', false, () => this.edit(view)));
    frame.appendChild(bar);

    // 图缩到 25% 时工具条比图还宽，默认的右对齐会让它整条往左甩出去。
    // 这种情况改成以图片为中心左右都溢出，看着才像有意为之。
    // 要等挂进文档才量得到宽度，所以放到下一帧。
    requestAnimationFrame(() => {
      if (!bar.isConnected) return;
      if (bar.offsetWidth > frame.clientWidth) {
        bar.style.right = 'auto';
        bar.style.left = '50%';
        bar.style.transform = 'translateX(-50%)';
      }
    });

    const grip = document.createElement('div');
    grip.className = 'img-grip';
    grip.title = '拖动调整宽度';
    this.wireGrip(grip, frame, fig, img, label, view);
    frame.appendChild(grip);
  }

  private toolButton(text: string, on: boolean, run: () => void): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.className = 'img-tool' + (on ? ' on' : '');
    // mousedown 就拦掉，不然点按钮会把焦点/光标带跑
    b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      run();
    });
    return b;
  }

  private wireGrip(
    grip: HTMLElement,
    frame: HTMLElement,
    fig: HTMLElement,
    img: HTMLImageElement,
    label: HTMLElement,
    view: EditorView
  ): void {
    grip.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startW = img.getBoundingClientRect().width;
      // 上限是正文可用宽度，和 CSS 的 max-width:100% 对齐
      const maxW = Math.max(80, Math.round(fig.getBoundingClientRect().width));
      let w = Math.round(startW);

      // 拖动过程中只改内联样式，不发事务 —— 每移动 1px 就重建一次 widget 会卡死
      const onMove = (ev: MouseEvent) => {
        w = Math.round(Math.min(maxW, Math.max(60, startW + ev.clientX - startX)));
        frame.style.width = w + 'px';
        img.style.width = '100%';
        label.textContent = w + 'px';
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.classList.remove('img-resizing');
        this.commit(view, String(w));
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.classList.add('img-resizing');
    });
  }

  /** 把宽度写进文档。w 为空串表示回到原始大小 */
  private commit(view: EditorView, w: string): void {
    const doc = view.state.doc;
    const line = doc.lineAt(Math.min(this.pos, doc.length));
    const next = withImageWidth(line.text, w);
    if (next === line.text) return;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: next },
      // 同一个事务里保住选中态，不然改完宽度把手就消失了
      effects: setSelectedImageEffect.of(line.from)
    });
  }

  private showMissing(fig: HTMLElement, msg: string): void {
    fig.classList.add('broken');
    const tip = document.createElement('span');
    tip.className = 'img-tip';
    tip.textContent = msg;
    fig.appendChild(tip);
  }

  // 自己处理鼠标事件，不让 CodeMirror 把点击解析到块外面去
  override ignoreEvent(): boolean { return false; }
}

function buildImages(state: EditorState): DecorationSet {
  const blocks = state.field(imageBlocksField);
  if (!blocks.length) return Decoration.none;

  const doc = state.doc;
  const sel = state.selection.main;
  const aFrom = doc.lineAt(sel.from).number;
  const aTo = doc.lineAt(sel.to).number;
  const base = state.field(imageBaseField);
  const chosen = state.field(selectedImageField);
  const out: Range<Decoration>[] = [];

  for (const b of blocks) {
    // 光标在这行：露出源码好改路径（双击图片才会走到这里）
    if (aFrom <= b.s && aTo >= b.s) continue;
    const line = doc.line(b.s);
    out.push(Decoration.replace({
      widget: new ImageWidget(b.src, b.alt, base, line.from, b.width, chosen === line.from),
      block: true
    }).range(line.from, line.to));
  }
  return out.length ? Decoration.set(out, true) : Decoration.none;
}

export const imageField = StateField.define<DecorationSet>({
  create: state => buildImages(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildImages(tr.state);
    // 换笔记时 base 变了得重算 URL；选中态变了得重画描边和工具条
    if (tr.effects.some(e => e.is(setImageBaseEffect) || e.is(setSelectedImageEffect))) {
      return buildImages(tr.state);
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f)
});

/**
 * 点到图片以外的地方就取消选中。
 * 监听在 window 上（捕获阶段），因为点左栏 / 中栏根本不会进编辑器的 DOM。
 */
export const imageSelectPlugin = ViewPlugin.fromClass(
  class {
    private readonly off: (e: MouseEvent) => void;
    constructor(readonly view: EditorView) {
      this.off = (e: MouseEvent) => {
        if (view.state.field(selectedImageField) < 0) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest?.('.cm-img')) return;
        view.dispatch({ effects: setSelectedImageEffect.of(-1) });
      };
      window.addEventListener('mousedown', this.off, true);
    }
    destroy(): void { window.removeEventListener('mousedown', this.off, true); }
  }
);

/* ============================================================
   笔记链接：点一下跳到那篇笔记
   ============================================================ */

export type LinkKind = 'wiki' | 'md';

let linkHandler: ((target: string, kind: LinkKind) => void) | null = null;

/** 右栏在启动时注册实现。编辑器本身不碰 store，保持「纯渲染层」 */
export function setLinkHandler(fn: ((target: string, kind: LinkKind) => void) | null): void {
  linkHandler = fn;
}

interface LinkHit { target: string; kind: LinkKind; }

/** 光标位置落在哪个链接的文字上 */
export function linkAt(state: EditorState, pos: number): LinkHit | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const col = pos - line.from;

  const wiki = /\[\[([^[\]\n]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wiki.exec(text))) {
    const a = m.index + 2;
    if (col >= a && col <= a + m[1].length) return { target: m[1].trim(), kind: 'wiki' };
  }

  const md = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
  while ((m = md.exec(text))) {
    const a = m.index + 1;
    if (col >= a && col <= a + m[1].length) return { target: m[2].trim(), kind: 'md' };
  }
  return null;
}

/**
 * 点链接就跳走。
 *
 * 两个细节必须一起做对：
 *   1. 挂在**捕获阶段**：CodeMirror 自己的 mousedown 在 contentDOM 上，
 *      冒泡到 view.dom 时它已经把光标挪进这一行了；
 *   2. 命中就立刻 preventDefault + stopPropagation，光标不动 ——
 *      光标一进这一行，整行会切回源码，链接的 span 当场被替换掉。
 */
export const linkPlugin = ViewPlugin.fromClass(
  class {
    private readonly onDown: (e: MouseEvent) => void;
    constructor(readonly view: EditorView) {
      this.onDown = (e: MouseEvent) => {
        if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!linkHandler) return;
        const t = e.target as HTMLElement | null;
        if (!t?.closest?.('.cm-link')) return;

        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return;
        const hit = linkAt(view.state, pos);
        if (!hit) return;

        e.preventDefault();
        e.stopPropagation();
        linkHandler(hit.target, hit.kind);
      };
      view.dom.addEventListener('mousedown', this.onDown, true);
    }
    destroy(): void { this.view.dom.removeEventListener('mousedown', this.onDown, true); }
  }
);

/* ============================================================
   行内标记
   ============================================================ */

const hideDeco = Decoration.replace({});
const lineDeco = (cls: string) => Decoration.line({ class: cls });
const hitMark = Decoration.mark({ class: 'cm-hit' });

interface Rule {
  re: RegExp;
  apply: (m: RegExpExecArray, ctx: {
    mark: (a: number, b: number, cls: string) => void;
    cut: (a: number, b: number) => void;
  }) => void;
}

const RULES: Rule[] = [
  // `[[另一篇笔记]]` 放最前面：它和 `[文字](链接)` 不冲突，但先匹配能少走一圈
  {
    re: /\[\[([^[\]\n]+)\]\]/g,
    apply(m, { mark, cut }) {
      const t0 = m.index + 2;
      const t1 = t0 + m[1].length;
      cut(m.index, t0);
      cut(t1, m.index + m[0].length);
      mark(t0, t1, 'cm-link cm-wikilink');
    }
  },
  {
    re: /\[([^\]]*)\]\(([^)]*)\)/g,
    apply(m, { mark, cut }) {
      const t0 = m.index + 1;
      const t1 = t0 + m[1].length;
      cut(m.index, t0);
      cut(t1, m.index + m[0].length);
      mark(t0, t1, 'cm-link');
    }
  },
  {
    re: /`([^`]+)`/g,
    apply(m, { mark, cut }) {
      const t0 = m.index + 1;
      const t1 = t0 + m[1].length;
      cut(m.index, t0);
      cut(t1, m.index + m[0].length);
      mark(t0, t1, 'cm-code');
    }
  },
  {
    re: /\*\*([^*]+)\*\*/g,
    apply(m, { mark, cut }) {
      const t0 = m.index + 2;
      const t1 = t0 + m[1].length;
      cut(m.index, t0);
      cut(t1, m.index + m[0].length);
      mark(t0, t1, 'cm-strong');
    }
  },
  {
    re: /~~([^~]+)~~/g,
    apply(m, { mark, cut }) {
      const t0 = m.index + 2;
      const t1 = t0 + m[1].length;
      cut(m.index, t0);
      cut(t1, m.index + m[0].length);
      mark(t0, t1, 'cm-strike');
    }
  },
  {
    re: /(?<!\*)\*([^*\n]+)\*(?!\*)/g,
    apply(m, { mark, cut }) {
      const t0 = m.index + 1;
      const t1 = t0 + m[1].length;
      cut(m.index, t0);
      cut(t1, m.index + m[0].length);
      mark(t0, t1, 'cm-em');
    }
  }
];

/** 处理一行里 skip 之后的部分：先做遮罩占位，避免多个规则互相踩 */
function inline(out: Range<Decoration>[], lineFrom: number, skip: number, text: string): void {
  const s = text.slice(skip);
  if (!s) return;
  const base = lineFrom + skip;
  const mask = new Uint8Array(s.length);
  const free = (a: number, b: number) => {
    for (let i = a; i < b; i++) if (mask[i]) return false;
    return true;
  };
  const claim = (a: number, b: number) => { for (let i = a; i < b; i++) mask[i] = 1; };
  const mark = (a: number, b: number, cls: string) => {
    if (b > a) out.push(Decoration.mark({ class: cls }).range(base + a, base + b));
  };
  const cut = (a: number, b: number) => {
    if (b > a) out.push(hideDeco.range(base + a, base + b));
  };

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(s))) {
      if (!m[0]) { rule.re.lastIndex++; continue; }
      if (!free(m.index, m.index + m[0].length)) continue;
      claim(m.index, m.index + m[0].length);
      rule.apply(m, { mark, cut });
    }
  }
}

/* ============================================================
   主装饰构建
   ============================================================ */

function buildDecorations(view: EditorView): DecorationSet {
  const state: EditorState = view.state;
  const doc = state.doc;
  const sel = state.selection.main;
  const aFrom = doc.lineAt(sel.from).number;
  const aTo = doc.lineAt(sel.to).number;
  const out: Range<Decoration>[] = [];

  // 代码块整块由 codeField 渲染，这里只负责「光标在块内」时的等宽源码样式
  const codeBlocks = state.field(codeBlocksField);
  const codeMap = new Map<number, CodeBlock>();
  for (const b of codeBlocks) for (let k = b.s; k <= b.e; k++) codeMap.set(k, b);

  if (!view.visibleRanges.length) return Decoration.none;

  const reveal = state.field(revealField) !== false;
  const focused = view.hasFocus;
  const firstLine = doc.lineAt(view.visibleRanges[0].from).number;
  const lastLine = doc.lineAt(view.visibleRanges[view.visibleRanges.length - 1].to).number;
  const tables = state.field(tableBlocksField);
  // 图片块是单行，用 Map 查比每条线都 find 一遍快
  const imageMap = new Map(state.field(imageBlocksField).map(b => [b.s, b]));

  for (let i = firstLine; i <= lastLine; i++) {
    const line = doc.line(i);
    const text = line.text;
    // 光标所在行露出源码
    const active = focused && reveal && i >= aFrom && i <= aTo;

    // 代码块：光标在块内就露出源码（围栏行 + 中间行都上等宽样式），否则整块交给 codeField
    const cb = codeMap.get(i);
    if (cb) {
      if (focused && aFrom <= cb.e && aTo >= cb.s) {
        for (let k = Math.max(cb.s, firstLine); k <= Math.min(cb.e, lastLine); k++) {
          out.push(lineDeco(k === cb.s || k === cb.e ? 'cm-fence' : 'cm-codeline')
            .range(doc.line(k).from));
        }
      }
      i = cb.e;
      continue;
    }
    if (!text) continue;

    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(text)) {
      if (!active) out.push(hideDeco.range(line.from, line.to));
      out.push(lineDeco('cm-hr').range(line.from));
      continue;
    }

    // 表格：整块由 tableField 渲染成真表格。
    // 这里只负责「光标在块内」时的等宽源码样式，其余情况交给 tableField，不能重复装饰。
    const tbl = tables.find(b => i >= b.s && i <= b.e);
    if (tbl) {
      // 整块替换后就没法编辑了，所以这块不看 reveal 开关
      if (focused && aFrom <= tbl.e && aTo >= tbl.s) {
        out.push(lineDeco(isTableSep(text) ? 'cm-tblsep' : 'cm-tbl').range(line.from));
      }
      i = tbl.e;
      continue;
    }

    // 图片：整行由 imageField 换成 <img>，这里只在光标进来时给源码上样式
    if (imageMap.has(i)) {
      if (focused && aFrom <= i && aTo >= i) out.push(lineDeco('cm-imgline').range(line.from));
      continue;
    }

    let skip = 0;
    let lineCls: string | null = null;
    let m: RegExpExecArray | null;

    m = /^(#{1,6})\s+/.exec(text);
    if (m) {
      lineCls = 'cm-h' + m[1].length;
      skip = m[0].length;
      if (!active) out.push(hideDeco.range(line.from, line.from + skip));
    }

    if (!lineCls) {
      m = /^(\s*>\s?)+/.exec(text);
      if (m) {
        lineCls = 'cm-quote';
        skip = m[0].length;
        if (!active) out.push(hideDeco.range(line.from, line.from + skip));
      }
    }

    if (!lineCls) {
      m = /^(\s*)([-*+])\s+\[([ xX])\]\s+/.exec(text);
      if (m) {
        const start = line.from + m[1].length;
        const bracket = line.from + m[0].lastIndexOf('[');
        const checked = m[3].toLowerCase() === 'x';
        const bodyFrom = line.from + m[0].length;

        // 解决方式写在箭头后面：
        // `- [ ] 修一下登录 → 换成新的 token 校验 [[登录改造]]`
        const am = /(?:→|->)/.exec(text.slice(m[0].length));
        const arrow = am ? m[0].length + am.index : -1;
        const arrowLen = am ? am[0].length : 0;

        if (!active) {
          out.push(Decoration.replace({ widget: new TodoWidget(checked, bracket) })
            .range(start, line.from + m[0].length));

          // 删除线必须在行内标记之前 push：同一 from 时长范围要先入。
          // 划掉的范围到箭头为止 —— 解决方式不是「待办本身」，不该跟着划掉
          const strikeTo = arrow >= 0 ? line.from + arrow : line.to;
          if (checked && strikeTo > bodyFrom) {
            out.push(Decoration.mark({ class: 'cm-todo-done' }).range(bodyFrom, strikeTo));
          }

          if (arrow >= 0) {
            out.push(Decoration.mark({ class: 'cm-todo-arrow' })
              .range(line.from + arrow, line.from + arrow + arrowLen));
            const noteFrom = line.from + arrow + arrowLen;
            if (line.to > noteFrom) {
              out.push(Decoration.mark({ class: 'cm-todo-note' }).range(noteFrom, line.to));
            }
          } else if (line.to > line.from) {
            out.push(Decoration.widget({ widget: new TodoNoteWidget(line.to), side: 1 })
              .range(line.to));
          }
        }
        lineCls = 'cm-todoline';
        skip = m[0].length;
      }
    }

    if (!lineCls) {
      m = /^(\s*)([-*+])\s+/.exec(text);
      if (m) {
        const start = line.from + m[1].length;
        if (!active) {
          out.push(Decoration.replace({ widget: new MarkerWidget('•', 'cm-bullet') })
            .range(start, line.from + m[0].length));
        }
        lineCls = 'cm-li';
        skip = m[0].length;
      }
    }

    if (!lineCls) {
      m = /^(\s*)(\d+)\.\s+/.exec(text);
      if (m) {
        const numStart = line.from + m[1].length;
        if (!active) out.push(Decoration.mark({ class: 'cm-olnum' }).range(numStart, numStart + m[2].length + 1));
        lineCls = 'cm-li';
        skip = m[0].length;
      }
    }

    if (lineCls) out.push(lineDeco(lineCls).range(line.from));
    if (active) continue;

    inline(out, line.from, skip, text);
  }

  return out.length ? Decoration.set(out, true) : Decoration.none;
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view); }
    update(u: ViewUpdate) {
      const revealChanged = u.startState.field(revealField) !== u.state.field(revealField);
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || revealChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: v => v.decorations }
);

/* ============================================================
   搜索命中高亮
   ============================================================ */

function buildHits(view: EditorView): DecorationSet {
  const q = view.state.field(searchField);
  if (!q) return Decoration.none;
  const needle = q.toLowerCase();
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to).toLowerCase();
    let i = 0;
    while (i + needle.length <= text.length) {
      const k = text.indexOf(needle, i);
      if (k < 0) break;
      out.push(hitMark.range(from + k, from + k + needle.length));
      i = k + needle.length;
    }
  }
  return out.length ? Decoration.set(out, true) : Decoration.none;
}

export const hitPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildHits(view); }
    update(u: ViewUpdate) {
      const qChanged = u.startState.field(searchField) !== u.state.field(searchField);
      if (u.docChanged || u.viewportChanged || qChanged) this.decorations = buildHits(u.view);
    }
  },
  { decorations: v => v.decorations }
);
