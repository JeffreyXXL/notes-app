import { noteById, allFolders, setNoteFolder, setNoteTags } from '../store';
import { attachCombo } from './combo';
import { createTagEditor } from './tags';
import type { TagEditor } from './tags';
import { DEFAULT_FOLDER } from '../core/path';

let metaId: string | null = null;
let folderReady = false;
let tagEditor: TagEditor | null = null;

function initFields(): void {
  if (folderReady) return;
  folderReady = true;

  const fIn = document.getElementById('meta-folder') as HTMLInputElement | null;
  if (fIn) {
    // 目录：单选，输入即过滤，回车/点击填进输入框
    attachCombo(
      fIn,
      q => {
        const k = q.trim().toLowerCase();
        const all = allFolders();
        return k ? all.filter(x => x.toLowerCase().includes(k)) : all;
      },
      v => { fIn.value = v; }
    );
  }

  const box = document.getElementById('meta-tags-box');
  const tIn = document.getElementById('meta-tags') as HTMLInputElement | null;
  if (box && tIn) tagEditor = createTagEditor(box, tIn);
}

export function openMeta(id: string): void {
  const n = noteById(id);
  if (!n) return;
  metaId = id;
  initFields();

  const fIn = document.getElementById('meta-folder') as HTMLInputElement | null;
  if (fIn) fIn.value = n.folder;
  tagEditor?.set(n.tags);
  document.getElementById('meta')?.classList.add('open');
}

export function closeMeta(): void {
  document.getElementById('meta')?.classList.remove('open');
}

export async function saveMeta(): Promise<void> {
  const n = noteById(metaId);
  if (!n) { closeMeta(); return; }

  const fIn = document.getElementById('meta-folder') as HTMLInputElement | null;
  const folder = (fIn?.value || '').trim() || DEFAULT_FOLDER;
  const tags = tagEditor ? tagEditor.get() : [];

  closeMeta();

  // 目录变了会真的移动文件
  await setNoteFolder(n, folder);
  setNoteTags(n, tags);
}
