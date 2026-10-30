import type { Note } from '../types';
import { headingOf } from './text';

/**
 * 模糊打分：子串命中优先（越靠前分越高），
 * 否则退化为「逐字符子序列」，按跳跃字符数扣分
 */
export function fuzzyScore(q: string, text: string): number {
  if (!q) return -1;
  const t = String(text).toLowerCase();
  const s = q.toLowerCase();

  const idx = t.indexOf(s);
  if (idx >= 0) return 120 - Math.min(idx, 60);

  let i = 0;
  let j = 0;
  let gap = 0;
  while (i < t.length && j < s.length) {
    if (t[i] === s[j]) j++;
    else gap++;
    i++;
  }
  if (j < s.length) return -1;
  return Math.max(1, 60 - Math.min(gap, 59));
}

/** 字段加权：标题 80 / 标签 50 / 目录 40 / 正文 0 */
const WEIGHTS = { title: 80, tags: 50, folder: 40, content: 0 };

export function searchNotes(q: string, base: Note[]): Note[] {
  const out: { n: Note; s: number }[] = [];
  for (const n of base) {
    let best = -1;
    const push = (v: number, w: number) => { if (v >= 0) best = Math.max(best, v + w); };
    push(fuzzyScore(q, n.title), WEIGHTS.title);
    push(fuzzyScore(q, n.tags.join(' ')), WEIGHTS.tags);
    push(fuzzyScore(q, n.folder), WEIGHTS.folder);
    push(fuzzyScore(q, n.content), WEIGHTS.content);
    if (best >= 0) out.push({ n, s: best });
  }
  return out.sort((a, b) => b.s - a.s).map(x => x.n);
}

/** 标题派生：`# ` 一级标题优先，否则用文件名 */
export function titleOf(content: string, name: string): string {
  return headingOf(content) || name || '无标题';
}
