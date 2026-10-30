/**
 * 纯 Node 的文件操作，和 Rust 侧 vault.rs 一一对应。
 * 不依赖 electron，可以单独用 node 跑测试。
 */
const fs = require('node:fs');
const path = require('node:path');

/** 把相对路径拼到根目录下，挡掉 `..` 和 `C:` 这类越权写法 */
function safeJoin(root, rel) {
  const normalized = String(rel).replace(/\\/g, '/');
  const r = path.resolve(root);
  let out = r;

  for (const seg of normalized.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..' || seg.includes(':')) throw new Error(`非法路径: ${rel}`);
    out = path.join(out, seg);
  }

  if (out !== r && !out.startsWith(r + path.sep)) throw new Error(`路径越界: ${rel}`);
  return out;
}

function mtimeOf(p) {
  try { return Math.round(fs.statSync(p).mtimeMs); } catch { return 0; }
}

/** 扫描整个笔记库，跳过隐藏目录 / 隐藏文件 */
function list(root) {
  const out = [];

  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);

      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      if (!e.name.toLowerCase().endsWith('.md')) continue;

      let raw;
      try { raw = fs.readFileSync(p, 'utf8'); } catch { continue; }

      out.push({
        relPath: path.relative(root, p).split(path.sep).join('/'),
        raw,
        mtime: mtimeOf(p)
      });
    }
  };

  walk(path.resolve(root));
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

function read(root, rel) {
  const p = safeJoin(root, rel);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
  return { relPath: rel, raw: fs.readFileSync(p, 'utf8'), mtime: mtimeOf(p) };
}

/** 原子写：先落 .tmp 再改名，避免写一半崩掉留下半个文件 */
function write(root, rel, raw) {
  const p = safeJoin(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, raw, 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`替换文件失败: ${err.message}`);
  }
  return mtimeOf(p);
}

/**
 * 二进制写：图片这类资源由渲染进程读成 base64 传过来。
 * 和 write() 一样走「临时文件 + 改名」，避免大图写到一半断电留下半个文件。
 */
function writeBinary(root, rel, base64) {
  const p = safeJoin(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const buf = Buffer.from(String(base64 || ''), 'base64');
  if (!buf.length) throw new Error('空文件');

  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, buf);
  try {
    fs.renameSync(tmp, p);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`替换文件失败: ${err.message}`);
  }
  return { relPath: rel, size: buf.length };
}

/** 相对路径下有没有这个文件（图片渲染时用来判断该按哪个目录解析） */
function exists(root, rel) {
  try {
    return fs.statSync(safeJoin(root, rel)).isFile();
  } catch {
    return false;
  }
}

function remove(root, rel) {
  const p = safeJoin(root, rel);
  try { fs.unlinkSync(p); } catch { /* 已经不在了 */ }

  // 顺手收走空目录
  const r = path.resolve(root);
  let dir = path.dirname(p);
  while (dir !== r && dir.startsWith(r + path.sep)) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { break; }
    if (entries.length) break;
    try { fs.rmdirSync(dir); } catch { break; }
    dir = path.dirname(dir);
  }
}

function rename(root, from, to) {
  const a = safeJoin(root, from);
  const b = safeJoin(root, to);
  fs.mkdirSync(path.dirname(b), { recursive: true });
  if (fs.existsSync(b)) throw new Error(`目标已存在: ${to}`);
  fs.renameSync(a, b);
}

/**
 * 删掉一个（此时应该是空的）目录，并一路往上把空掉的父目录也收走。
 *
 * 注意要**递归往下**先收：目录改名只搬文件，里面的空子目录会留下，
 * 只看顶层有没有条目的话 `技术/` 里还剩一个空的 `技术/子目录/`，
 * 于是「旧目录不要了」这件事就没做成。
 * 只删空目录，目录里但凡还有文件就停手。
 */
function prune(root, rel) {
  const r = path.resolve(root);
  const from = String(rel || '').replace(/\\/g, '/');
  if (!from) return;

  let top;
  try { top = safeJoin(root, from); } catch { return; }

  const sweep = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    let empty = true;
    for (const e of entries) {
      if (e.isDirectory()) {
        if (sweep(path.join(dir, e.name))) continue;
      }
      empty = false;
    }
    if (!empty) return false;
    try { fs.rmdirSync(dir); return true; } catch { return false; }
  };

  sweep(top);

  let dir = path.dirname(top);
  while (dir !== r && dir.startsWith(r + path.sep)) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { break; }
    if (entries.length) break;
    try { fs.rmdirSync(dir); } catch { break; }
    dir = path.dirname(dir);
  }
}

module.exports = {
  safeJoin, mtimeOf, list, read, write, writeBinary, exists, remove, rename, prune
};
