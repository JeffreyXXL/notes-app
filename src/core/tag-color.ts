/**
 * 标签配色。
 *
 * 目标：同一个标签永远是同一个颜色，同一批标签之间尽量不撞色。
 *
 * 光靠哈希不行——12 个色板槽，8 个标签就有一半概率撞上。
 * 所以这里做全局分配：先把老标签原来的颜色占住，新标签再按哈希找空槽，
 * 这样加一个新标签不会把已有的颜色全打乱。
 */

// 均匀 30° 一圈。不均匀的话总会出现两个特别接近的色相，
// 淡色下就分不出来了。
const HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

function rawHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

let current = new Map<string, number>(); // 标签 -> 色板槽位

/**
 * 从 start 往后找一个离已有颜色最远的空槽。
 * 简单往后 +1 会让标签挤在相邻色相上（红旁边是橙，肉眼很难分），
 * 挑最远的能让颜色铺开。
 */
function pickSlot(start: number, used: Set<number>): number {
  const n = HUES.length;
  let best = start;
  let bestDist = -1;

  for (let i = 0; i < n; i++) {
    const slot = (start + i) % n;
    if (used.has(slot)) continue;

    let minDist = n;
    for (const u of used) {
      const d = Math.abs(slot - u);
      minDist = Math.min(minDist, d, n - d);
    }
    if (minDist > bestDist) {
      bestDist = minDist;
      best = slot;
    }
  }
  return best;
}

/** 每次重新渲染前同步一次标签全集，给新标签分配空槽 */
export function syncTagColors(tags: Iterable<string>): void {
  const list = [...new Set(tags)];
  const used = new Set<number>();
  const next = new Map<string, number>();

  // 1. 老标签保留原来的槽位，加个新标签不会把已有颜色全打乱
  for (const t of list) {
    const slot = current.get(t);
    if (slot !== undefined && !used.has(slot)) {
      next.set(t, slot);
      used.add(slot);
    }
  }

  // 2. 新标签挑一个离现有颜色最远的空槽
  for (const t of list) {
    if (next.has(t)) continue;
    const slot = pickSlot(rawHash(t) % HUES.length, used);
    used.add(slot);
    next.set(t, slot);
  }

  current = next;
}

export function tagHue(tag: string): number {
  const slot = current.get(tag);
  return HUES[slot !== undefined ? slot : rawHash(tag) % HUES.length];
}

/** 直接拼进 style 属性，配合 CSS 里的 --th 变量 */
export function tagStyle(tag: string): string {
  return `--th:${tagHue(tag)}`;
}
