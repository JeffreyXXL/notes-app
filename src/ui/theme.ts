import { store, saveSettings } from '../store';
import { FONTS } from '../settings';
import type { Settings } from '../types';
import { getEditor } from './right';

const mqDark = window.matchMedia('(prefers-color-scheme: dark)');

/** 把设置映射到 DOM：主题、字体族、字号、行距 */
export function applySettings(): void {
  const s = store.settings;
  const root = document.documentElement;

  if (s.font === 'sys') root.removeAttribute('data-font');
  else root.setAttribute('data-font', s.font);

  // 色系与明暗是两个独立维度，组合出 6 套
  root.setAttribute('data-scheme', s.scheme || 'paper');

  const dark = s.theme === 'dark' || (s.theme === 'auto' && mqDark.matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');

  root.style.setProperty('--doc-size', s.size + 'px');
  root.style.setProperty('--doc-lh', String(s.lh));

  applyAppName();

  // 字号变了 CodeMirror 需要重新量行高
  const view = getEditor();
  if (view) setTimeout(() => view.requestMeasure(), 60);
}

/** 左上角的名字同时是窗口标题，改完立刻生效 */
export function applyAppName(): void {
  const name = store.settings.appName || '笔记';
  const brand = document.getElementById('brand-name');
  if (brand) brand.textContent = name;
  document.title = name;
}

mqDark.addEventListener('change', () => {
  if (store.settings.theme === 'auto') applySettings();
});

export function renderFontOpts(): void {
  const box = document.getElementById('font-opts');
  if (!box) return;
  box.innerHTML = FONTS.map(f => `
    <div class="opt ${store.settings.font === f.id ? 'on' : ''}" data-f="${f.id}">
      <span class="radio"></span>
      <span class="nm">${f.name}</span>
      <span class="sm" style="font-family:${f.css}">产品方向思考 Aa 2026</span>
    </div>`).join('');

  box.querySelectorAll<HTMLElement>('.opt').forEach(el => {
    el.addEventListener('click', () => {
      store.settings.font = el.dataset.f as Settings['font'];
      saveSettings();
      renderFontOpts();
      applySettings();
    });
  });
}

/** 分段选择器：data-v 写进指定字段 */
export function bindSeg(
  id: string,
  key: keyof Settings,
  cast?: (v: string) => unknown,
  after?: () => void
): void {
  const box = document.getElementById(id);
  if (!box) return;
  box.querySelectorAll<HTMLElement>('span').forEach(el => {
    el.addEventListener('click', () => {
      box.querySelectorAll('span').forEach(x => x.classList.remove('on'));
      el.classList.add('on');
      const v = cast ? cast(el.dataset.v || '') : (el.dataset.v || '');
      (store.settings as unknown as Record<string, unknown>)[key] = v;
      saveSettings();
      if (after) after();
    });
  });
}

/** 把设置值回填到分段控件的选中态（设置从文件恢复时用） */
export function syncSeg(id: string, value: unknown): void {
  const box = document.getElementById(id);
  if (!box) return;
  box.querySelectorAll<HTMLElement>('span').forEach(el => {
    el.classList.toggle('on', String(value) === el.dataset.v);
  });
}
