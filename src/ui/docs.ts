/**
 * 文档：把任意文件收进笔记库，双击用系统默认程序打开。
 *
 * 分工很清楚：
 *   - 主进程负责复制 / 打开 / 在资源管理器里定位（它才有 fs 和 shell）
 *   - 这里负责「把复制完的结果变成一篇笔记」和所有提示
 *
 * 为什么不把文件塞进 .md：Word / PDF / 压缩包都是二进制，
 * 混进正文会让纯文本的库变得没法用别的编辑器打开。原件单独放 `_docs/`，
 * `.md` 只记路径和体积，正文留给备注。
 */

import { createDocNote } from '../store';
import { invoke, hasDesktopBridge } from '../storage/ipc';
import { readBase64 } from '../core/image';
import { toast } from '../core/toast';
import type { Note } from '../types';

/** 主进程复制完回来的那份信息 */
export interface ImportedDoc {
  relPath: string;
  name: string;
  size: number;
  ext: string;
}

/** 文档的文件名（取路径最后一段）—— 卡片和右栏显示的都是它 */
export function docFileName(note: Note): string {
  const p = note.doc || '';
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

/** 徽标上的大写后缀；没有后缀就写「文件」 */
export function docExt(note: Note): string {
  const name = docFileName(note);
  const i = name.lastIndexOf('.');
  const e = i < 0 ? '' : name.slice(i + 1);
  return e ? e.toUpperCase() : '文件';
}

/** 一批落盘结果 → 一批笔记。返回真的建起来的篇数 */
async function addNotes(docs: ImportedDoc[]): Promise<number> {
  let n = 0;
  for (const d of docs) {
    const note = await createDocNote({ docPath: d.relPath, name: d.name, size: d.size });
    if (note) n++;
  }
  return n;
}

function desktopOnly(): boolean {
  if (hasDesktopBridge()) return true;
  toast('浏览器预览模式放不下文档，请用桌面版');
  return false;
}

function report(n: number): void {
  if (n <= 0) return;
  toast(n > 1 ? `已添加 ${n} 个文档` : '已添加文档');
}

/** 「添加文档」按钮：系统文件选择框，可多选 */
export async function pickDocs(): Promise<void> {
  if (!desktopOnly()) return;
  try {
    const docs = await invoke<ImportedDoc[]>('doc_pick');
    report(await addNotes(docs));
  } catch (err) {
    console.error('[notes-app] 添加文档失败', err);
    toast('添加文档失败');
  }
}

/**
 * 拖进来的一批文件。
 *
 * 优先拿真实路径交给主进程直接复制（大文件也不怕）；
 * 拿不到路径（某些来源、或旧版外壳）才退回「读成 base64 再传」。
 */
export async function importDocFiles(files: File[]): Promise<void> {
  if (!files.length || !desktopOnly()) return;

  const bridge = window.notesBridge;
  const paths: string[] = [];
  const noPath: File[] = [];

  for (const f of files) {
    const p = bridge?.pathForFile?.(f) || '';
    if (p) paths.push(p);
    else noPath.push(f);
  }

  let n = 0;
  if (paths.length) {
    try {
      n += await addNotes(await invoke<ImportedDoc[]>('doc_import', { paths }));
    } catch (err) {
      console.error('[notes-app] 导入文档失败', err);
    }
  }

  for (const f of noPath) {
    try {
      const doc = await invoke<ImportedDoc>('doc_save', {
        name: f.name || '文档',
        base64: await readBase64(f)
      });
      n += await addNotes([doc]);
    } catch (err) {
      console.error('[notes-app] 导入文档失败', f.name, err);
    }
  }

  if (!n) toast('没能添加这些文件');
  else report(n);
}

/** 双击卡片 / 点右栏的「打开」：交给系统默认程序 */
export async function openDoc(note: Note): Promise<void> {
  if (!note.doc) return;
  if (!desktopOnly()) return;

  try {
    const err = await invoke<string>('doc_open', { rel_path: note.doc });
    if (err === 'missing') toast(`文件不在了：${docFileName(note)}`);
    else if (err) toast('这个文件没有能打开它的程序');
  } catch (err) {
    console.error('[notes-app] 打开文档失败', err);
    toast('打不开这个文件');
  }
}

/** 在资源管理器里定位到原件 —— 「我想把它发给别人」时用 */
export async function revealDoc(note: Note): Promise<void> {
  if (!note.doc || !hasDesktopBridge()) return;
  try {
    const ok = await invoke<boolean>('doc_reveal', { rel_path: note.doc });
    if (!ok) toast(`文件不在了：${docFileName(note)}`);
  } catch (err) {
    console.error('[notes-app] 定位文档失败', err);
  }
}

/**
 * 窗口级兜底：文件落在列表和编辑器以外的地方（左栏、右栏空白处）也能收进来。
 *
 * 编辑器的图片拖放会 preventDefault（那是「把图插进正文」），
 * 这种情况 defaultPrevented 为真，这里就不插手了。
 */
export function bindWindowDrop(): void {
  window.addEventListener('dragover', e => {
    if (e.defaultPrevented) return;
    const types = e.dataTransfer?.types;
    if (!types || !Array.from(types).includes('Files')) return;
    // 不拦的话 Chromium 会直接把整个窗口导航到那个文件
    e.preventDefault();
  });

  window.addEventListener('drop', e => {
    if (e.defaultPrevented) return;
    const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
    if (!files.length) return;
    e.preventDefault();
    void importDocFiles(files);
  });
}
