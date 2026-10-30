import { esc } from '../core/text';

/**
 * 可输入可选的下拉框：聚焦时列出全部候选项，输入时按关键词过滤，
 * 支持 ↑↓ 选择、Enter 确认、Esc 关闭。
 */
export function attachCombo(
  input: HTMLInputElement,
  getItems: (q: string) => string[],
  onPick: (v: string) => void
): void {
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  document.body.appendChild(menu);

  let list: string[] = [];
  let active = -1;
  let opened = false;

  const place = () => {
    const r = input.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = (r.bottom + 5) + 'px';
    menu.style.width = r.width + 'px';
  };

  const close = () => {
    opened = false;
    active = -1;
    menu.classList.remove('open');
  };

  const paint = () => {
    if (!list.length) { close(); return; }
    menu.innerHTML = list
      .map((t, i) => `<div class="combo-item${i === active ? ' on' : ''}" data-i="${i}">${esc(t)}</div>`)
      .join('');
    place();
    menu.classList.add('open');
    opened = true;
  };

  const show = (q: string) => {
    list = getItems(q).slice(0, 9);
    active = list.length ? 0 : -1;
    paint();
  };

  const pick = (i: number) => {
    if (i < 0 || i >= list.length) return;
    onPick(list[i]);
    close();
    input.focus();
  };

  input.addEventListener('focus', () => show(''));
  input.addEventListener('input', () => show(input.value));
  input.addEventListener('keydown', e => {
    if (!opened) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % list.length;
      paint();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + list.length) % list.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 130));

  menu.addEventListener('mousedown', e => {
    const it = (e.target as HTMLElement).closest<HTMLElement>('.combo-item');
    if (!it) return;
    e.preventDefault();
    pick(Number(it.dataset.i));
  });

  // 窗口尺寸变化时只重定位，不要关掉——否则某些窗口管理器一抖动菜单就没了
  window.addEventListener('resize', () => { if (opened) place(); });
  window.addEventListener('scroll', () => { if (opened) place(); }, true);
}
