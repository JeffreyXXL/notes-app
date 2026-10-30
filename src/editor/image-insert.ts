/**
 * 把图片存进笔记库，并插到正文里。
 *
 * 三个入口共用这一套：快捷栏的「插入图片」、Ctrl+V 粘贴、把文件拖进编辑区。
 */

import type { EditorView } from '@codemirror/view';
import { store } from '../store';
import { insertImage } from './commands';
import {
  newAssetPath, altOf, isImageFile, readBase64, readDataUrl, stashBrowserAsset
} from '../core/image';

/**
 * 落盘一张图，返回可以写进 markdown 的库内相对路径。
 * 失败返回 null（磁盘满、浏览器本地存储放不下之类）。
 */
export async function saveImageFile(file: File): Promise<string | null> {
  const storage = store.storage;
  if (!storage) return null;

  const rel = newAssetPath(file.name || 'image.png');

  if (storage.writeAsset) {
    try {
      await storage.writeAsset(rel, await readBase64(file));
      return rel;
    } catch (err) {
      console.error('[notes-app] 保存图片失败', file.name, err);
      return null;
    }
  }

  // 浏览器模式没有真正的文件系统：把 data URL 塞进 localStorage。
  // 正文里仍然写库内相对路径，渲染时由 assetUrl 还原成 data URL。
  // localStorage 只有 5MB 左右，这张图太大就直接放弃并提示。
  const ok = stashBrowserAsset(rel, await readDataUrl(file));
  if (!ok) {
    console.warn('[notes-app] 浏览器本地存储放不下这张图片，请用桌面版');
    return null;
  }
  return rel;
}

/** 存一批图并逐个插入，返回成功的张数 */
export async function insertImages(
  view: EditorView,
  files: File[],
  at?: number
): Promise<number> {
  const list = files.filter(isImageFile);
  if (!list.length) return 0;

  let n = 0;
  for (const f of list) {
    const rel = await saveImageFile(f);
    if (!rel) continue;
    // 只有第一张用传进来的位置；后面的跟着光标走，
    // 否则每张都用同一个旧下标，文档一改位置就错了
    insertImage(view, rel, altOf(f.name || ''), n === 0 ? at : undefined);
    n++;
  }
  return n;
}

/** 从 DataTransfer 里挑出图片文件（粘贴和拖拽都用得到） */
export function imageFilesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const f of Array.from(dt.files || [])) {
    if (isImageFile(f)) out.push(f);
  }
  return out;
}

/* ============================================================
   文件选择器
   ============================================================ */

/**
 * 复用同一个 <input type="file">：
 * 每次新建元素的话，用户点了取消就永远等不到 change，元素只能一直挂着。
 */
let picker: HTMLInputElement | null = null;
let pickerTarget: EditorView | null = null;

export function pickImages(view: EditorView): void {
  if (!picker) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      // 清空 value，同一张图连着插两次才会再次触发 change
      input.value = '';
      const v = pickerTarget;
      pickerTarget = null;
      if (v && files.length) void insertImages(v, files);
    });

    picker = input;
  }

  pickerTarget = view;
  picker.click();
}
