/**
 * 轻提示。
 *
 * 放在 core 而不是 ui/links：编辑器层（复制图片、点空链接）也要用，
 * 而 ui/links 依赖 store，从编辑器反向 import 会绕成一个环。
 * 这里零依赖，谁都能用。
 */

let toastTimer: number | null = null;

export function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el?.classList.remove('show'); }, 1800);
}
