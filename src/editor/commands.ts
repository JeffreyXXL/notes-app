/**
 * 编辑器里的 Markdown 编辑命令。
 *
 * 快捷栏和键盘快捷键共用这一套，避免两边逻辑各写一遍。
 * 全部只做「选区/行」级别的文本替换，不改动编辑器配置。
 */

// 注意是值导入不是 import type：insertImage 里要用 EditorView.scrollIntoView 这个静态方法
import { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { codeBlocksField } from './live-preview';
import { store, noteById, resolveLink } from '../store';
import { dirOf } from '../core/path';

/** 用 before/after 包住选区；再点一次取消。没有选区时插入一对标记并把光标放中间。 */
export function toggleWrap(view: EditorView, before: string, after = before, hint = ''): void {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;

  // 没选中：插一对标记，光标落在中间
  if (from === to) {
    const insert = before + hint + after;
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + before.length, head: from + before.length + hint.length }
    });
    view.focus();
    return;
  }

  const inner = doc.sliceString(from, to);
  const outsideBefore = doc.sliceString(Math.max(0, from - before.length), from);
  const outsideAfter = doc.sliceString(to, Math.min(doc.length, to + after.length));

  // 标记在选区外侧：去掉
  if (outsideBefore === before && outsideAfter === after) {
    view.dispatch({
      changes: [
        { from: from - before.length, to: from, insert: '' },
        { from: to, to: to + after.length, insert: '' }
      ],
      selection: { anchor: from - before.length, head: to - before.length }
    });
  } else if (inner.length >= before.length + after.length
    && inner.startsWith(before) && inner.endsWith(after)) {
    // 标记在选区内部：去掉
    const stripped = inner.slice(before.length, inner.length - after.length);
    view.dispatch({
      changes: { from, to, insert: stripped },
      selection: { anchor: from, head: from + stripped.length }
    });
  } else {
    view.dispatch({
      changes: [
        { from, insert: before },
        { from: to, insert: after }
      ],
      selection: { anchor: from + before.length, head: to + before.length }
    });
  }
  view.focus();
}

/** 给选中的每一行加前缀；如果全都已经有了，就全部去掉。 */
export function toggleLinePrefix(view: EditorView, prefix: string): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const first = doc.lineAt(sel.from).number;
  const last = doc.lineAt(sel.to).number;

  const lines = [];
  for (let i = first; i <= last; i++) lines.push(doc.line(i));

  const allHave = lines.every(l => l.text.startsWith(prefix));
  const changes = [];
  for (const line of lines) {
    if (allHave) changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
    else if (!line.text.startsWith(prefix)) changes.push({ from: line.from, insert: prefix });
  }

  if (changes.length) view.dispatch({ changes });
  view.focus();
}

/** 标题级别循环：无 → ## → ### → 无 */
export function cycleHeading(view: EditorView): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const line = doc.lineAt(sel.from);
  const m = /^(#{1,6})\s+/.exec(line.text);

  let next: string;
  if (!m) next = '## ';
  else if (m[1].length === 2) next = '### ';
  else if (m[1].length === 3) next = '';
  else next = '## ';

  view.dispatch({
    changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert: next },
    selection: { anchor: line.from + next.length }
  });
  view.focus();
}

/** 在当前行后面插一段独立块（表格 / 分隔线），自动和上下文隔开空行。 */
export function insertBlock(view: EditorView, block: string): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const line = doc.lineAt(sel.to);

  const lead = line.text.trim() ? '\n\n' : '';
  const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
  const tail = next && next.text.trim() ? '\n' : '';
  const text = lead + block + tail;

  view.dispatch({
    changes: { from: line.to, insert: text },
    selection: { anchor: line.to + text.length }
  });
  view.focus();
}

/** 插入链接：有选中文字就拿它当链接文字，光标自动落在 url 上 */
/**
 * 当前这篇笔记的真实目录（库内相对路径）。
 *
 * 不能用 `note.folder`：直接放在库根的笔记，那个字段会退化成「收集箱」
 * 这个展示用默认值，拿它拼路径会把链接指到一个不存在的目录。
 */
function currentDir(): string {
  const n = noteById(store.state.selectedId);
  return n ? dirOf(n.relPath) : '';
}

/** `[[目录/文件名]]`；目录为空时就是 `[[文件名]]` */
function linkText(relDir: string, name: string): string {
  return relDir ? `${relDir}/${name}` : name;
}

/**
 * 插入站内链接 `[[另一篇笔记]]`。
 * 有选中文字就把它当目标（顺手把文字改成链接），没选就留个占位让人直接打字。
 *
 * 开了「笔记链接带完整目录」时写成 `[[目录/标题]]`：笔记库按目录分客户，
 * 不同目录下重名是常态，只写标题点下去会跳到别人的笔记里。
 */
export function insertWikiLink(view: EditorView): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const dir = currentDir();
  const full = store.settings.linkPath;

  if (sel.from === sel.to) {
    const ph = '笔记名';
    const target = full ? linkText(dir, ph) : ph;
    const text = `[[${target}]]`;
    // 光标只框住名字部分，目录前缀是已经定好的
    const start = sel.from + 2 + target.length - ph.length;
    view.dispatch({
      changes: { from: sel.from, insert: text },
      selection: { anchor: start, head: start + ph.length }
    });
    return;
  }

  const raw = doc.sliceString(sel.from, sel.to);
  const label = raw.trim();
  // 选中的文字如果正好是某篇笔记的名字，就补成它的真实路径
  const hit = full ? resolveLink(label, dir) : null;
  const target = hit ? linkText(dirOf(hit.relPath), hit.name) : label;
  const text = `[[${target}]]`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + 2, head: sel.from + 2 + target.length }
  });
}

export function insertLink(view: EditorView): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;

  if (sel.from === sel.to) {
    const text = '[链接文字](url)';
    view.dispatch({
      changes: { from: sel.from, insert: text },
      selection: { anchor: sel.from + 1, head: sel.from + 5 }
    });
  } else {
    const label = doc.sliceString(sel.from, sel.to);
    const text = `[${label}](url)`;
    const urlStart = sel.from + label.length + 3;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: urlStart, head: urlStart + 3 }
    });
  }
  view.focus();
}

export const TABLE_TEMPLATE = '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |';
/**
 * 插入一张图片。
 *
 * 图片必须单独占一行才会被渲染成图（见 live-preview 的 parseImageLine），
 * 所以这里负责把它和上下文隔开：光标所在行是空行就直接占用它，
 * 有内容就另起一段。插完把光标放到图片下面一行 —— 不然光标还停在这行，
 * 这行就会一直保持源码态，看起来像「没插进去」。
 */
export function insertImage(
  view: EditorView,
  relPath: string,
  alt = '',
  at?: number
): void {
  const doc = view.state.doc;
  const pos = Math.max(0, Math.min(at ?? view.state.selection.main.to, doc.length));
  const line = doc.lineAt(pos);
  const block = `![${alt}](${relPath})`;

  if (!line.text.trim()) {
    // 空行：直接占掉，光标落到新的一行
    const text = block + '\n';
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: text },
      selection: { anchor: line.from + text.length },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' })
    });
  } else {
    // 有内容：前后各空一行，别把原来的句子劈成两半
    const text = '\n\n' + block + '\n';
    view.dispatch({
      changes: { from: line.to, insert: text },
      selection: { anchor: line.to + text.length },
      effects: EditorView.scrollIntoView(line.to, { y: 'center' })
    });
  }
  view.focus();
}

/* ============================================================
   回车续格式
   ============================================================ */

/** 一行开头的块级标记：`raw` 是这行已有的原文，`next` 是回车后新行该带的 */
interface LineMarkup {
  /** 匹配到的前缀原文（`- [x] ` 原样保留），用来判断「标记后面还有没有内容」 */
  raw: string;
  /** 新行要带的前缀 */
  next: string;
}

/**
 * 认出这行属于哪种块级结构。
 *
 * 顺序有讲究：待办 `- [ ] ` 必须先于无序列表 `- ` 匹配，
 * 否则 `- [ ] x` 会被当成普通列表项，续下去就成了 `- ` 而不是 `- [ ] `。
 */
function markupOf(rest: string): LineMarkup | null {
  // 待办：`- [ ] ` / `* [x] `。新行一律回到未勾选
  let m = /^([-*+])\s+\[[ xX]\](?:\s+|$)/.exec(rest);
  if (m) return { raw: m[0], next: `${m[1]} [ ] ` };

  // 无序列表：`- ` `* ` `+ `
  m = /^([-*+])(?:\s+|$)/.exec(rest);
  if (m) return { raw: m[0], next: `${m[1]} ` };

  // 有序列表：`1. ` `2) `。序号自动加一
  m = /^(\d+)([.)])(?:\s+|$)/.exec(rest);
  if (m) return { raw: m[0], next: `${Number(m[1]) + 1}${m[2]} ` };

  // 引用：`> ` `> > `，套几层续几层
  const q = /^(?:>[ \t]?)+/.exec(rest);
  if (q) return { raw: q[0], next: q[0] };

  return null;
}

/** 光标这一行在不在围栏代码块里（含围栏行本身） */
function inCodeBlock(state: EditorState, lineNumber: number): boolean {
  const blocks = state.field(codeBlocksField, false) ?? [];
  return blocks.some(b => lineNumber >= b.s && lineNumber <= b.e);
}

/**
 * 回车时把当前行的 Markdown 前缀带到下一行 —— 待办、无序/有序列表、引用。
 *
 * 只接管「光标在行尾、没有选区」的情况：在行中间回车还硬续前缀，
 * 等于把半句话劈成两条，比不续更难受，那种情况交回 CodeMirror 默认行为。
 *
 * 空条目（只有前缀没内容）回车反而是**把前缀去掉** —— 这是退不出去的死角：
 * 少了这一步，列表末尾想恢复正常段落就只能退格删字。
 *
 * 返回 false 表示「这次回车不归我管」，让 defaultKeymap 里的
 * insertNewlineAndIndent 接着处理。
 */
export function continueMarkup(view: EditorView): boolean {
  // 输入法正在组合时，回车是「确认候选词」而不是换行。
  // CodeMirror 自己也会挡一道，但中文输入是主要用法，这里再明确拦一次
  if (view.composing) return false;

  const state = view.state;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;

  const line = state.doc.lineAt(sel.from);
  if (sel.from !== line.to) return false;

  // 代码块里回车就是换行。往代码里塞 `- ` 是灾难，而且会把语法高亮带歪
  if (inCodeBlock(state, line.number)) return false;

  const text = line.text;
  // 缩进照抄，嵌套列表不会因为一次回车掉回外层
  const indent = /^[ \t]*/.exec(text)![0];
  const rest = text.slice(indent.length);
  const mk = markupOf(rest);
  if (!mk) return false;

  // 这一条已经是空的：回车 = 结束列表，把整行清空，别再生成下一条
  if (!rest.slice(mk.raw.length).trim()) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from }
    });
    return true;
  }

  const insert = '\n' + indent + mk.next;
  view.dispatch({
    changes: { from: sel.from, insert },
    selection: { anchor: sel.from + insert.length }
  });
  return true;
}
