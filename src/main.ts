import './styles/index.css';

import { store, initStore, reload, flushAll } from './store';
import { onChange } from './bus';
import { renderAll, applyCollapse, toggleCol } from './ui';
import { applySettings } from './ui/theme';
import { initSettingsUI, renderVaultInfo } from './ui/settings';
import { clearSearch } from './ui/left';
import { renderMid, closeOtherSwipes } from './ui/mid';
import { syncEditorSearch } from './ui/right';
import { newNote } from './ui/actions';
import { saveMeta, closeMeta } from './ui/meta';
import { initTitlebar } from './ui/titlebar';
import { maybeLockOnBoot, isLocked } from './ui/lock';
import { setVaultRoot } from './core/image';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/* ============================================================
   启动
   ============================================================ */

async function boot(): Promise<void> {
  try {
    await initStore();
  } catch (err) {
    console.error('[notes-app] 初始化失败', err);
    showFatal(err);
    return;
  }

  applySettings();
  applyCollapse();

  // Tauri 侧渲染图片要拼绝对路径，先把库根交出去（Electron 用不到，但无害）
  setVaultRoot(store.vault.root);

  // 默认展开所有目录，和原型行为一致
  const walk = (notes: typeof store.notes) => {
    notes.forEach(n => {
      let cur = '';
      n.folder.split('/').filter(Boolean).forEach(p => {
        cur = cur ? cur + '/' + p : p;
        store.state.expanded.add(cur);
      });
    });
  };
  walk(store.notes);

  initSettingsUI();
  initTitlebar();
  bindGlobal();
  onChange(renderAll);
  renderAll();

  $('boot')?.classList.add('hide');
  setTimeout(() => {
    $('boot')?.remove();
    // 开了密码锁定就在这时候盖上来，别让内容先闪一下
    maybeLockOnBoot();
  }, 260);
}

function showFatal(err: unknown): void {
  const b = $('boot');
  if (b) {
    b.classList.remove('hide');
    b.textContent = '笔记库加载失败：' + (err instanceof Error ? err.message : String(err));
  }
}

/* ============================================================
   全局交互
   ============================================================ */

function bindGlobal(): void {
  /* ---- 左栏 tab 切换 ---- */
  document.querySelectorAll<HTMLElement>('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      store.state.mode = (t.dataset.mode || 'folder') as typeof store.state.mode;
      store.state.filter = null;
      clearSearch();
      renderAll();
    });
  });

  /* ---- 两栏折叠 ---- */
  $('collapse-left')?.addEventListener('click', () => toggleCol('left'));
  $('restore-left')?.addEventListener('click', () => toggleCol('left'));
  $('collapse-mid')?.addEventListener('click', () => toggleCol('mid'));
  $('restore-mid')?.addEventListener('click', () => toggleCol('mid'));

  /* ---- 搜索 ---- */
  const searchInput = $<HTMLInputElement>('search');
  let searchTimer: number | null = null;

  searchInput?.addEventListener('input', () => {
    store.state.search = searchInput.value;
    $('search-box')?.classList.toggle('has', !!store.state.search);
    syncEditorSearch(true);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderMid, 110);
  });

  $('search-clear')?.addEventListener('click', () => {
    clearSearch();
    renderMid();
    syncEditorSearch(false);
    searchInput?.focus();
  });

  /* ---- 键盘 ---- */
  document.addEventListener('keydown', e => {
    // 锁屏时不响应任何快捷键，连 Esc 也不放行
    if (isLocked()) return;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
      return;
    }

    if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      void newNote();
      return;
    }

    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void flushAll();
      return;
    }

    if (e.key === 'Escape') {
      if (searchInput && searchInput.value && document.activeElement === searchInput) {
        clearSearch();
        renderMid();
        syncEditorSearch(false);
      }
      document.querySelectorAll('.backdrop.open').forEach(b => b.classList.remove('open'));
      closeOtherSwipes(null);
    }
  });

  /* ---- 整理面板 ---- */
  const metaEl = $('meta');
  $('close-meta')?.addEventListener('click', closeMeta);
  $('meta-cancel')?.addEventListener('click', closeMeta);
  $('meta-save')?.addEventListener('click', () => { void saveMeta(); });
  metaEl?.addEventListener('click', e => { if (e.target === metaEl) closeMeta(); });

  /* ---- 迷你操作菜单 ---- */
  const actionsEl = $('actions');
  $('mini-cancel')?.addEventListener('click', () => actionsEl?.classList.remove('open'));
  actionsEl?.addEventListener('click', e => {
    if (e.target === actionsEl) actionsEl.classList.remove('open');
  });

  /* ---- 点空白处收起左滑操作条 ---- */
  document.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('.swipe')) closeOtherSwipes(null);
  });

  /* ---- 退出前落盘 ---- */
  window.addEventListener('beforeunload', () => {
    void flushAll();
    void store.storage?.saveSettings(store.settings);
  });

  window.addEventListener('blur', () => { void flushAll(); });

  // 外部改了笔记库（比如手动放了 .md 进去），切回窗口时刷新一次
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void (async () => {
      await flushAll();
      await reload();
      renderAll();
      renderVaultInfo();
    })();
  });
}

void boot();
