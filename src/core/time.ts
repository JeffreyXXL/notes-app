/** 时间格式化：列表卡片用 `MM-DD HH:mm`，跨年补年份 */

const pad = (n: number) => String(n).padStart(2, '0');

export function formatStamp(ts: number, now = Date.now()): string {
  if (!ts) return '';
  const d = new Date(ts);
  const n = new Date(now);
  if (now - ts < 60_000) return '刚刚';
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === n.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
