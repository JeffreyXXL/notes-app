/** 通用文本工具：转义、搜索高亮、待办统计、摘要提取 */

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 只高亮第一处命中，用于列表卡片 */
export function hl(text: string, q: string): string {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return text.slice(0, i) + '<mark>' + text.slice(i, i + q.length) + '</mark>' + text.slice(i + q.length);
}

export function todoStats(s: string): { total: number; done: number } {
  const m = [...s.matchAll(/^(\s*)[-*+]\s*\[([ xX])\]/gm)];
  const done = m.filter(x => x[2].toLowerCase() === 'x').length;
  return { total: m.length, done };
}

/** 正文首个一级标题作为标题 */
export function headingOf(content: string): string | null {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1].trim() : null;
}

/**
 * 把围栏代码块整段抹掉（连围栏行一起）。
 * 代码里写的 `![x](y)` 不是图片，卡片上不该冒出一张缩略图。
 * 按行扫而不是写正则：围栏的配对靠反向引用很难写对，行扫描一眼能看懂。
 */
function stripFences(s: string): string {
  const out: string[] = [];
  let fence: string | null = null;

  for (const line of s.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      const ch = m[1][0];
      if (!fence) { fence = ch; out.push(''); continue; }
      if (ch === fence) { fence = null; out.push(''); continue; }
    }
    out.push(fence ? '' : line);
  }
  return out.join('\n');
}

/** 一张卡片最多看几张图，再多也没地方放 */
const MAX_CARD_IMAGES = 6;

/**
 * 正文里所有图片的路径（按出现顺序，去重）。卡片缩略图用。
 * 兼容 `![alt](path)` 和 `![alt](<带空格的路径>)` 两种写法；
 * 代码块里的不算。
 */
export function allImages(s: string): string[] {
  const re = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))/g;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const m of stripFences(s).matchAll(re)) {
    const p = (m[1] || m[2] || '').trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= MAX_CARD_IMAGES) break;
  }
  return out;
}

/** 正文里第一张图片的路径，没有就返回空串 */
export function firstImage(s: string): string {
  return allImages(s)[0] || '';
}

/**
 * 生成卡片摘要（中栏卡片上那段灰色预览文字）。
 *
 * 依次尝试：正文段落 → 表格首行数据 → 代码块首行。都取不到才返回空串，
 * 由调用方决定显示什么（比如「空白笔记」）。
 *
 * 几个必须守住的点：
 * - 单独成块的图片跳过。卡片右边有缩略图，摘要里再写一遍 `_assets/xxx.png` 没意义
 * - 普通段落要**整块**参与，不能只取第一行。用户经常不空行地连写几行，
 *   只取第一行会把后面全丢掉，看起来就像「内容不显示」
 * - 表格 / 代码块不能直接跳过。整篇只有一张表的笔记，摘要空着也是「内容不显示」
 */
export function excerpt(s: string, n: number): string {
  // 先统一换行符。Windows 上编辑过的 .md 是 CRLF，`\r\n\r\n` 在 split(/\n{2,}/) 里切不开，
  // 整篇会被当成一个块，再被下面「首块是标题就丢掉」整块扔掉 —— 摘要直接空掉。
  const src = s.replace(/\r\n?/g, '\n');
  const blocks = src.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  // 首块是标题就丢掉：标题已经显示在卡片上方了
  if (blocks.length && /^#{1,6}\s/.test(blocks[0])) blocks.shift();

  const text: string[] = [];
  const table: string[] = [];
  const code: string[] = [];
  let len = 0;

  for (const b of blocks) {
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(b)) continue;

    if (/^(```|~~~)/.test(b)) {
      const first = b.split('\n').slice(1).find(l => l.trim() && !/^(```|~~~)/.test(l));
      if (first) code.push(first.trim());
      continue;
    }

    if (/^\|/.test(b)) {
      const rows = b.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
      // 跳过表头和 `| --- |` 分隔行，取第一行真正的数据
      const data = rows.slice(1).find(l => !/^\|?[\s:|-]+\|?$/.test(l));
      if (data) {
        table.push(data.replace(/^\||\|$/g, '').split('|')
          .map(c => c.trim()).filter(Boolean).join(' · '));
      }
      continue;
    }

    for (const raw of b.split('\n')) {
      if (/^[|#]/.test(raw) || /^(```|~~~)/.test(raw)) continue;
      const t = raw
        .replace(/^[-*+]\s+\[[ xX]\]\s*/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/^\s*>\s?/, '')
        .trim();
      if (!t) continue;
      text.push(t);
      len += t.length + 1;
      if (len > n) break;
    }
    if (len > n) break;
  }

      const clean = (arr: string[]): string => arr.join(' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        // 先收 `[[双链]]` 的方括号，否则下面那条 `[文字](链接)` 规则匹配不到它
        .replace(/\[\[([^[\]\n]+)\]\]/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

  const out = clean(text) || clean(table) || clean(code);
  return out.length > n ? out.slice(0, n) + '…' : out;
}

/** 统计正文中某关键词出现次数（用于右栏提示） */
export function countHits(text: string, q: string): number {
  if (!q) return 0;
  const t = String(text).toLowerCase();
  const s = String(q).toLowerCase();
  let i = 0;
  let n = 0;
  while ((i = t.indexOf(s, i)) >= 0) { n++; i += s.length; }
  return n;
}
