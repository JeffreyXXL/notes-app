import type { NoteMeta } from '../types';

/**
 * .md 文件的 front matter 读写。
 *
 * 为什么不用 YAML 库：只需要 6 个固定字段，手写解析可以避免引入依赖，
 * 也避免把用户正文里不规范的 YAML 解析炸掉。
 *
 * 文件格式：
 * ```
 * ---
 * tags: [产品, 战略]
 * pinned: true
 * archived: false
 * trashed: false
 * created: 2026-10-22T10:02:00.000Z
 * updated: 2026-10-26T08:40:00.000Z
 * ---
 *
 * # 正文标题
 * ```
 */

export const FM_KEYS = ['tags', 'pinned', 'archived', 'trashed', 'hidden', 'created', 'updated', 'order'] as const;

export interface ParsedFile {
  meta: Partial<NoteMeta>;
  body: string;
  /** 原文里是否真的带 front matter */
  hasFrontMatter: boolean;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function parseScalar(v: string): string | boolean {
  const s = v.trim().replace(/^["']|["']$/g, '');
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

function parseArray(v: string): string[] {
  const s = v.trim();
  if (!s) return [];
  const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  return inner.split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

export function parseFrontMatter(raw: string): ParsedFile {
  // 统一换行符。Windows 上用记事本 / 别的编辑器改过的 .md 是 CRLF，
  // 留着会让所有「按空行切块」的逻辑失效（摘要空白、表格认不出、图片不渲染）。
  // 写回时 serializeFrontMatter 一律用 LF，所以这里归一化不会反复横跳。
  const src = raw.replace(/\r\n?/g, '\n');

  const m = FM_RE.exec(src);
  if (!m) return { meta: {}, body: src, hasFrontMatter: false };

  const meta: Partial<NoteMeta> = {};
  const lines = m[1].split(/\r?\n/);
  let listKey: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    // 块状列表：`- 项目`
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      if (listKey === 'tags') (meta.tags as string[]).push(String(parseScalar(item[1])));
      continue;
    }

    const kv = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2];

    switch (key) {
      case 'tags':
        if (!val.trim()) { meta.tags = []; listKey = 'tags'; }
        else { meta.tags = parseArray(val); listKey = null; }
        break;
      case 'pinned':
      case 'archived':
      case 'trashed':
      case 'hidden':
        meta[key] = parseScalar(val) === true;
        listKey = null;
        break;
      case 'created':
      case 'updated': {
        const t = Date.parse(String(parseScalar(val)));
        if (!Number.isNaN(t)) meta[key] = t;
        listKey = null;
        break;
      }
      case 'order': {
        const n = Number(String(parseScalar(val)));
        if (Number.isFinite(n)) meta.order = n;
        listKey = null;
        break;
      }
      default:
        listKey = null;
    }
  }

  return { meta, body: src.slice(m[0].length), hasFrontMatter: true };
}

function yamlArray(items: string[]): string {
  // 含特殊字符时用引号包起来
  const safe = items.map(t => (/[,[\]{}:#&*!|>'"%@`]/.test(t) ? `"${t.replace(/"/g, '\\"')}"` : t));
  return `[${safe.join(', ')}]`;
}

export function serializeFrontMatter(meta: NoteMeta, body: string): string {
  const lines = [
    '---',
    `tags: ${yamlArray(meta.tags)}`,
    `pinned: ${meta.pinned}`,
    `archived: ${meta.archived}`,
    `trashed: ${meta.trashed}`,
    `created: ${new Date(meta.created).toISOString()}`,
    `updated: ${new Date(meta.updated).toISOString()}`
  ];
  // order 只在真的排过序之后才写，老笔记不会被平白加上一行
  if (typeof meta.order === 'number' && Number.isFinite(meta.order)) {
    lines.push(`order: ${Math.round(meta.order)}`);
  }
  // hidden 同理：只有隐藏了才写这一行，绝大多数笔记的 front matter 保持原样
  if (meta.hidden) lines.push('hidden: true');
  lines.push('---', '');
  return lines.join('\n') + body;
}

/** 只替换正文、保留原有 front matter 之外的任何内容（用于写回） */
export function withBody(raw: string, body: string): string {
  const m = FM_RE.exec(raw);
  if (!m) return body;
  return raw.slice(0, m[0].length) + body;
}
