/**
 * 编辑器里的 Markdown 编辑命令。
 *
 * 快捷栏和键盘快捷键共用这一套，避免两边逻辑各写一遍。
 * 全部只做「选区/行」级别的文本替换，不改动编辑器配置。
 */

// 注意是值导入不是 import type：insertImage 里要用 EditorView.scrollIntoView 这个静态方法
import { EditorView } from '@codemirror/view';

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
 * 插入站内链接 `[[另一篇笔记]]`。
 * 有选中文字就把它当目标（顺手把文字改成链接），没选就留个占位让人直接打字。
 */
export function insertWikiLink(view: EditorView): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;

  if (sel.from === sel.to) {
    const text = '[[笔记名]]';
    view.dispatch({
      changes: { from: sel.from, insert: text },
      selection: { anchor: sel.from + 2, head: sel.from + 5 }
    });
    return;
  }

  const label = doc.sliceString(sel.from, sel.to);
  const text = `[[${label}]]`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + 2, head: sel.from + 2 + label.length }
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
