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
import { isHlColor } from '../settings';
import { dirOf } from '../core/path';
import type { HlColor } from '../types';

/**
 * 改文档之前先把焦点还给正文。
 *
 * view.focus() 自己会做一次选区同步（focusPreventScroll + updateSelection）。
 * 放在 dispatch 后面调用，就等于把刚设好的光标位置又盖一遍 ——
 * 点浮窗按钮时光标莫名跑到行尾就是这么来的。所以统一改成「先聚焦，再改」。
 */
function ensureFocus(view: EditorView): void {
  if (!view.hasFocus) view.focus();
}

/** 用 before/after 包住选区；再点一次取消。没有选区时插入一对标记并把光标放中间。 */
export function toggleWrap(view: EditorView, before: string, after = before, hint = ''): void {
  ensureFocus(view);
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;

  // 没选中：插一对标记，光标落在中间
  if (from === to) {
    const insert = before + hint + after;
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + before.length, head: from + before.length + hint.length }
    });
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
}

/* ============================================================
   高亮：逐处上色
   ============================================================ */

/** 一处高亮在文档里的位置 */
interface HlHit {
  /** 正文起点（`==` 之后） */
  from: number;
  /** 正文终点（收尾 `==` 之前） */
  to: number;
  color: HlColor;
  /** 后面那个 `{色号}` 的长度，没有色号就是 0 */
  sufLen: number;
}

/** 光标 / 选区所在的这一行里，包住它的那处高亮；不在任何高亮里返回 null */
function hlAt(state: EditorState, pos: number): HlHit | null {
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  const re = /==([^=\s][^=\n]*?)==(?:\{([a-z]{3,8})\})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line.text))) {
    const a = m.index + 2;
    const b = a + m[1].length;
    const known = isHlColor(m[2]);
    const sufLen = known ? m[2].length + 2 : 0;
    const color: HlColor = isHlColor(m[2]) ? m[2] : store.settings.hlColor;
    // 落在 `==` 的左侧边界上不算「在里面」—— 那更像是想在这一处前面新起一段
    if (col > m.index && col <= b + 2 + sufLen) {
      return { from: line.from + a, to: line.from + b, color, sufLen };
    }
  }
  return null;
}

/**
 * 套 / 改 / 取消高亮。
 *
 * 和 `toggleWrap` 分开写，是因为高亮现在带色号：`==文字=={green}`。
 * 写成后缀而不是 `=={green}文字==`，是为了不动正文 —— 光标停在字里的时候，
 * 后缀在行尾，看起来就是普通的高亮。
 *
 * 规则（先看「是不是已经在一处高亮里」，再看选区）：
 * - 光标/选区整个落在某处高亮里、点了别的笔 → 只改那处的色号，正文一个字不动
 * - 同上、点的还是同一支笔 → 整处取消（当开关用）
 * - 选了字、外面没有高亮 → 包一层，需要时补色号
 * - 只点了光标、也不在任何高亮里 → 插一对空的，光标停在「高亮」上直接改名
 *
 * 「光标停在高亮里」这条最要紧：想给已有的高亮换个颜色，人一定是先点进去
 * 再选色。少了这条就会在旁边新插一对 `==`，把一处高亮劈成两处。
 *
 * 色号和默认笔一样时不写进正文，省得每处都挂一截 `{yellow}`。
 */
export function toggleHighlight(view: EditorView, color: HlColor): void {
  ensureFocus(view);
  const { state } = view;
  const doc = state.doc;
  const sel = state.selection.main;
  const suffix = color === store.settings.hlColor ? '' : `{${color}}`;

  // ① 已经在这一处高亮里：换色 / 取消
  const hit = hlAt(state, sel.from);
  if (hit && hit.to >= sel.to) {
    if (hit.color === color) {
      view.dispatch({
        changes: [
          { from: hit.from - 2, to: hit.from, insert: '' },
          { from: hit.to, to: hit.to + 2 + hit.sufLen, insert: '' }
        ],
        selection: { anchor: hit.from - 2 }
      });
      return;
    }
    // 不设 selection，让 CodeMirror 自己把光标映射过去：色号长短变了也不会跑偏
    view.dispatch({
      changes: { from: hit.to + 2, to: hit.to + 2 + hit.sufLen, insert: suffix }
    });
    return;
  }

  // ② 只点了光标：插一对空的，光标框住占位词
  if (sel.from === sel.to) {
    const text = `==高亮==${suffix}`;
    view.dispatch({
      changes: { from: sel.from, insert: text },
      selection: { anchor: sel.from + 2, head: sel.from + 4 }
    });
    return;
  }

  const { from, to } = sel;
  const inner = doc.sliceString(from, to);

  // ③ 选区把 `==…==` 整个框进来了：剥掉标记按新颜色重新包
  if (inner.length > 4 && inner.startsWith('==') && inner.endsWith('==')) {
    const body = inner.slice(2, -2);
    view.dispatch({
      changes: { from, to, insert: `==${body}==${suffix}` },
      selection: { anchor: from + 2, head: from + 2 + body.length }
    });
    return;
  }

  // ④ 普通选区：包一层
  view.dispatch({
    changes: [
      { from, insert: '==' },
      { from: to, insert: `==${suffix}` }
    ],
    selection: { anchor: from + 2, head: to + 2 }
  });
}

/** 用默认笔套高亮。快捷栏按钮和 Ctrl+Shift+H 都走这里 */
export function highlightDefault(view: EditorView): void {
  toggleHighlight(view, store.settings.hlColor);
}

/**
 * 光标所在那处高亮用的是什么颜色；不在高亮里就返回默认笔。
 * 只给色板标「当前是哪个」用，不参与渲染。
 */
export function hlColorAt(view: EditorView): HlColor {
  const state = view.state;
  return hlAt(state, state.selection.main.head)?.color ?? store.settings.hlColor;
}

/** 给选中的每一行加前缀；如果全都已经有了，就全部去掉。 */
export function toggleLinePrefix(view: EditorView, prefix: string): void {
  ensureFocus(view);
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const first = doc.lineAt(sel.from).number;
  const last = doc.lineAt(sel.to).number;

  const lines = [];
  for (let i = first; i <= last; i++) lines.push(doc.line(i));

  const allHave = lines.every(l => l.text.startsWith(prefix));
  const changes = [];
  // 改完之后光标该落在哪：行尾。点「待办 / 列表 / 引用」就是想接着往下写，
  // 光标留在原来的列上（甚至被前缀挤到行首之前）等于还要再按一次 End
  let caret = -1;
  for (const line of lines) {
    if (allHave) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
      caret = line.to - prefix.length;
    } else if (!line.text.startsWith(prefix)) {
      changes.push({ from: line.from, insert: prefix });
      caret = line.to + prefix.length;
    } else {
      caret = line.to;
    }
  }

  // 本来就有前缀、什么都没改：光标也送到行尾
  if (!changes.length) {
    if (sel.empty) view.dispatch({ selection: { anchor: doc.lineAt(sel.to).to } });
    return;
  }

  view.dispatch({
    changes,
    // 只动光标不选区的情况才接管光标；选了多行就保持选区，别把它折叠掉
    selection: sel.empty && caret >= 0 ? { anchor: caret } : undefined
  });
}

/** 标题级别循环：无 → ## → ### → 无 */
export function cycleHeading(view: EditorView): void {
  ensureFocus(view);
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const line = doc.lineAt(sel.from);
  const m = /^(#{1,6})\s+/.exec(line.text);

  let next: string;
  if (!m) next = '## ';
  else if (m[1].length === 2) next = '### ';
  else if (m[1].length === 3) next = '';
  else next = '## ';

  // 光标落到行尾：点标题按钮是想把这一行变成标题后接着写，
  // 停在 `## ` 后面反而把原来的位置丢了
  const bodyLen = line.text.length - (m ? m[0].length : 0);
  view.dispatch({
    changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert: next },
    selection: { anchor: line.from + next.length + bodyLen }
  });
}

/** 在当前行后面插一段独立块（表格 / 分隔线），自动和上下文隔开空行。 */
export function insertBlock(view: EditorView, block: string): void {
  ensureFocus(view);
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
  ensureFocus(view);
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
  ensureFocus(view);
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
  ensureFocus(view);
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
}

/* ============================================================
   Tab / Shift-Tab 缩进
   ============================================================ */

/** 一个缩进单位。和 markdown 列表的常见写法一致，两个空格 */
const INDENT_UNIT = '  ';

/**
 * Tab 缩进、Shift-Tab 反缩进。
 *
 * 为什么不用 @codemirror/commands 的 `indentWithTab`：它转手给 `indentMore`，
 * 而 `indentMore` 的缩进量取自 `indentUnit` facet。这个应用没装任何语言包，
 * 也没人提供这个 facet —— 取到的是空串，于是「Tab 被吃掉了但一个字都没插入」，
 * 表现就是用户说的「Tab 不能用」。自己算更可控。
 *
 * 没选区时在光标处插/删一个单位；有选区就整段加减（和大多数编辑器一致）。
 * 返回 true 表示这次按键归我们管，别让焦点跑出去。
 */
export function indentBlock(view: EditorView, dir: 1 | -1): boolean {
  ensureFocus(view);
  const { state } = view;
  const sel = state.selection.main;

  if (sel.empty) {
    if (dir > 0) {
      view.dispatch({
        changes: { from: sel.from, insert: INDENT_UNIT },
        selection: { anchor: sel.from + INDENT_UNIT.length },
        userEvent: 'input'
      });
      return true;
    }
    // 反缩进：只吃行首已有的空白，不会把光标前的正文吃掉
    const line = state.doc.lineAt(sel.from);
    const head = /^[ \t]+/.exec(line.text);
    if (!head) return true;
    const cut = Math.min(head[0].length, INDENT_UNIT.length);
    view.dispatch({
      changes: { from: line.from, to: line.from + cut, insert: '' },
      selection: { anchor: Math.max(line.from, sel.from - cut) },
      userEvent: 'delete'
    });
    return true;
  }

  const first = state.doc.lineAt(sel.from).number;
  const last = state.doc.lineAt(sel.to).number;
  const changes = [];
  for (let i = first; i <= last; i++) {
    const line = state.doc.line(i);
    if (dir > 0) {
      changes.push({ from: line.from, insert: INDENT_UNIT });
    } else {
      const head = /^[ \t]+/.exec(line.text);
      if (head) {
        changes.push({
          from: line.from,
          to: line.from + Math.min(head[0].length, INDENT_UNIT.length),
          insert: ''
        });
      }
    }
  }
  if (changes.length) view.dispatch({ changes, userEvent: dir > 0 ? 'input.indent' : 'delete.dedent' });
  return true;
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
