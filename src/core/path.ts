/** 路径工具：统一用 `/` 分隔，跨平台由 Rust 侧转换 */

export const DEFAULT_FOLDER = '收集箱';

export function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}

export function baseName(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  const f = i < 0 ? relPath : relPath.slice(i + 1);
  return f.replace(/\.md$/i, '');
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}

/** 目录名清洗：去掉 Windows 非法字符，合并多余斜杠 */
export function normalizeFolder(input: string): string {
  const cleaned = input
    .replace(/[\\]/g, '/')
    .split('/')
    .map(seg => seg.trim().replace(/[<>:"|?*\u0000-\u001f]/g, ''))
    .filter(Boolean)
    .join('/');
  return cleaned || DEFAULT_FOLDER;
}

/** 文件名清洗：Windows 保留名 + 非法字符 */
export function sanitizeName(input: string): string {
  let s = input.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!s) s = '无标题';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = '_' + s;
  return s.slice(0, 80);
}

/** 在同一目录下找一个不冲突的文件名 */
export function uniquePath(existing: Set<string>, folder: string, base: string): string {
  const name = sanitizeName(base);
  let candidate = joinPath(folder, name);
  if (!existing.has(candidate.toLowerCase())) return candidate;
  for (let i = 2; i < 1000; i++) {
    candidate = joinPath(folder, `${name} ${i}`);
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return joinPath(folder, `${name} ${Date.now()}`);
}
