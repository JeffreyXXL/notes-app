import { store, reload, saveSettings, patchSettings } from '../store';
import { bindSeg, applySettings, applyAppName, renderFontOpts, syncSeg } from './theme';
import { renderAll } from './index';
import { setReveal } from '../editor';
import { getEditor } from './right';
import { formatBytes } from '../core/time';
import { promptSetPassword, lockNow } from './lock';
import { toast } from './links';

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/* ============================================================
   数据区
   ============================================================ */

/**
 * 长路径只留「盘符 + 最后一级」。
 *
 * 以前是「前 12 个字 + … + 后 26 个字」，Windows 下前 12 个字正好是
 * `C:\Users\你的用户名`，截图发出去等于把用户名一起发了。
 * 完整路径仍然挂在 title 上，鼠标停一下就能看到，点击也照旧能打开目录。
 */
function shortPath(p: string): string {
  if (p.length <= 44) return p;
  const m = /^[A-Za-z]:[\\/]/.exec(p);
  const head = m ? m[0] : '';
  const parts = p.slice(head.length).split(/[\\/]/).filter(Boolean);
  const tail = parts.slice(-2).join('\\');
  return tail ? head + '…\\' + tail : p;
}

export function renderVaultInfo(): void {
  const p = el<HTMLElement>('vault-path');
  if (p) {
    p.textContent = store.vault.root ? shortPath(store.vault.root) : '—';
    p.title = store.vault.kind === 'fs'
      ? `${store.vault.root}\n点击在文件管理器中打开`
      : '浏览器沙盒（localStorage），仅供开发调试';
  }
  const idx = el<HTMLElement>('idx-info');
  if (idx) idx.textContent = `${store.notes.length} 篇 · ${formatBytes(store.totalBytes)}`;
}

/** 重建索引 = 重新扫描笔记库（.md 才是真相源） */
async function reindex(btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  btn.textContent = '重建中…';
  try {
    await reload();
    renderAll();
    renderVaultInfo();
    btn.textContent = '已重建';
  } catch (err) {
    console.error('[notes-app] 重建索引失败', err);
    btn.textContent = '失败';
  }
  setTimeout(() => { btn.textContent = '重建索引'; btn.disabled = false; }, 900);
}

/* ============================================================
   设置项与 DOM 双向同步
   ============================================================ */

export function syncSettingsUI(): void {
  const s = store.settings;

  syncSeg('seg-scheme', s.scheme);
  syncSeg('seg-theme', s.theme);
  syncSeg('seg-size', String(s.size));
  syncSeg('seg-lh', String(s.lh));
  syncSeg('seg-close', s.closeAction);

  el('sw-reveal')?.classList.toggle('on', s.reveal);
  el('sw-title')?.classList.toggle('on', s.titleRename);
  el('sw-swipe')?.classList.toggle('on', s.swipe);
  el('sw-autostart')?.classList.toggle('on', s.autostart);
  el('sw-lock')?.classList.toggle('on', s.lockEnabled);

  const name = el<HTMLInputElement>('inp-appname');
  if (name && name.value !== s.appName) name.value = s.appName;

  const opts = el('swipe-opts');
  if (opts) {
    opts.classList.toggle('off', !s.swipe);
    opts.querySelectorAll<HTMLElement>('span').forEach(sp => {
      sp.classList.toggle('on', !!s.swipeActs[sp.dataset.a as keyof typeof s.swipeActs]);
    });
  }
}

export function initSettingsUI(): void {
  const sheet = el('settings');

  /* ---- 面板开关 ---- */
  el('open-settings')?.addEventListener('click', () => {
    renderVaultInfo();
    sheet?.classList.add('open');
  });
  el('close-settings')?.addEventListener('click', () => sheet?.classList.remove('open'));
  sheet?.addEventListener('click', e => { if (e.target === sheet) sheet.classList.remove('open'); });

  /* ---- 分段选择器 ---- */
  bindSeg('seg-scheme', 'scheme', undefined, applySettings);
  bindSeg('seg-theme', 'theme', undefined, applySettings);
  bindSeg('seg-size', 'size', parseFloat, applySettings);
  bindSeg('seg-lh', 'lh', parseFloat, applySettings);
  bindSeg('seg-close', 'closeAction');

  /* ---- 编辑器：光标行露源码 ---- */
  el('sw-reveal')?.addEventListener('click', e => {
    const t = e.currentTarget as HTMLElement;
    store.settings.reveal = !store.settings.reveal;
    t.classList.toggle('on', store.settings.reveal);
    saveSettings();
    setReveal(getEditor(), store.settings.reveal);
  });

  /* ---- 标题同步文件名 ---- */
  el('sw-title')?.addEventListener('click', e => {
    const t = e.currentTarget as HTMLElement;
    store.settings.titleRename = !store.settings.titleRename;
    t.classList.toggle('on', store.settings.titleRename);
    saveSettings();
  });

  /* ---- 左上角名字 ---- */
  const nameInput = el<HTMLInputElement>('inp-appname');
  nameInput?.addEventListener('input', () => {
    const v = nameInput.value.trim();
    // 清空时先不写进设置，等失焦再回填默认值 —— 否则边删边跳成「笔记」很别扭
    store.settings.appName = v || '笔记';
    applyAppName();
    saveSettings();
  });
  nameInput?.addEventListener('blur', () => {
    nameInput.value = store.settings.appName;
  });

  /* ---- 密码锁定 ---- */
  el('sw-lock')?.addEventListener('click', () => {
    if (store.settings.lockEnabled) {
      store.settings.lockEnabled = false;
      saveSettings();
      syncSettingsUI();
      return;
    }
    // 已经设过密码就直接打开并立刻锁一次，让用户确认密码没记错
    if (store.settings.lockHash) {
      store.settings.lockEnabled = true;
      saveSettings();
      syncSettingsUI();
      lockNow();
      return;
    }
    void promptSetPassword();
  });

  el('btn-setpw')?.addEventListener('click', () => { void promptSetPassword(); });

  el('btn-locknow')?.addEventListener('click', () => {
    if (!store.settings.lockEnabled || !store.settings.lockHash) {
      toast('先打开「密码锁定」');
      return;
    }
    lockNow();
  });

  /* ---- 左滑总开关 ---- */
  el('sw-swipe')?.addEventListener('click', () => {
    store.settings.swipe = !store.settings.swipe;
    saveSettings();
    syncSettingsUI();
    renderAll();
  });

  /* ---- 左滑显示哪些操作：至少留一个 ---- */
  const opts = el('swipe-opts');
  opts?.querySelectorAll<HTMLElement>('span').forEach(sp => {
    sp.addEventListener('click', () => {
      const k = sp.dataset.a as keyof typeof store.settings.swipeActs;
      const acts = store.settings.swipeActs;
      const onKeys = (Object.keys(acts) as (keyof typeof acts)[]).filter(x => acts[x]);
      if (acts[k] && onKeys.length === 1) return; // 不允许全部关掉
      acts[k] = !acts[k];
      saveSettings();
      syncSettingsUI();
      renderAll();
    });
  });

  /* ---- 开机自启：真的写系统注册表 / LaunchAgent ---- */
  el('sw-autostart')?.addEventListener('click', e => {
    const t = e.currentTarget as HTMLElement;
    const next = !store.settings.autostart;
    t.classList.toggle('on', next);
    patchSettings({ autostart: next });
    void store.storage?.setAutostart?.(next).catch(err => {
      console.error('[notes-app] 设置开机自启失败', err);
      store.settings.autostart = !next;
      t.classList.toggle('on', !next);
      saveSettings();
    });
  });

  /* ---- 重建索引 ---- */
  el<HTMLButtonElement>('btn-reindex')?.addEventListener('click', function () {
    void reindex(this);
  });

  /* ---- 点击路径打开文件夹 ---- */
  el('vault-path')?.addEventListener('click', () => {
    void store.storage?.reveal?.();
  });

  renderFontOpts();
  syncSettingsUI();
  renderVaultInfo();
}
