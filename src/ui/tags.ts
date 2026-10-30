import { esc } from '../core/text';
import { tagStyle } from '../core/tag-color';
import { allTags } from '../store';

/**
 * 标签多选编辑器。
 *
 * 为什么不用原来那个 attachCombo：它是「单个值」的下拉框，选一个就关掉，
 * 想加三个标签得来回点三次输入框。这里改成 token 输入框：
 *   - 已选标签渲染成一排带 × 的 chips
 *   - 输入框里打新标签，回车直接加（不要求标签已存在）
 *   - 输入框为空时按退格删掉最后一个
 *   - 已有标签以淡色 chips 排在下面，点一下就加，可以连着点
 *
 * 为什么「已有标签」不用下拉菜单：整理弹层里标签栏紧挨着「取消 / 保存」，
 * 下拉菜单（position:fixed）会正好盖住这两个按钮，用户点保存反而加了个标签。
 * 改成弹层内部的一排 chips，既不遮挡也不会有「点穿」问题。
 */
export interface TagEditor {
  set(tags: string[]): void;
  get(): string[];
}

/** 已有标签最多显示几个，太多了会把弹层撑得老高 */
const SUGGEST_LIMIT = 16;

export function createTagEditor(box: HTMLElement, input: HTMLInputElement): TagEditor {
  let selected: string[] = [];
  let list: string[] = [];

  // 已选 chips 排在输入框前面，所以这块用 insertBefore(input)
  const suggest = document.createElement('div');
  suggest.className = 'tag-suggest';
  box.after(suggest);

  const paintChips = (): void => {
    box.querySelectorAll('.te-chip').forEach(el => el.remove());
    const frag = document.createDocumentFragment();
    selected.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'te-chip';
      chip.setAttribute('style', tagStyle(t));
      chip.innerHTML = `<span class="te-tx">${esc(t)}</span><i class="te-x" data-t="${esc(t)}">×</i>`;
      frag.appendChild(chip);
    });
    box.insertBefore(frag, input);
  };

  const paintSuggest = (q: string): void => {
    const k = q.trim().toLowerCase();
    const chosen = new Set(selected);
    list = allTags()
      .filter(t => !chosen.has(t) && (!k || t.toLowerCase().includes(k)))
      .slice(0, SUGGEST_LIMIT);

    if (!list.length) {
      suggest.innerHTML = '';
      suggest.classList.add('empty');
      return;
    }
    suggest.classList.remove('empty');
    suggest.innerHTML = list
      .map(t => `<span class="tg" data-t="${esc(t)}" style="${tagStyle(t)}">${esc(t)}</span>`)
      .join('');
  };

  const add = (t: string): void => {
    const v = t.trim();
    if (!v || selected.includes(v)) return;
    selected.push(v);
    input.value = '';
    paintChips();
    paintSuggest('');
  };

  const remove = (t: string): void => {
    selected = selected.filter(x => x !== t);
    paintChips();
    paintSuggest(input.value);
  };

  /* ---- chips 上的 × ---- */
  box.addEventListener('mousedown', e => {
    const x = (e.target as HTMLElement).closest<HTMLElement>('.te-x');
    if (!x) return;
    e.preventDefault();
    e.stopPropagation();
    remove(x.dataset.t || '');
    input.focus();
  });

  /* ---- 点下面的淡色 chips 加标签 ---- */
  suggest.addEventListener('mousedown', e => {
    const tg = (e.target as HTMLElement).closest<HTMLElement>('.tg');
    if (!tg) return;
    e.preventDefault();
    add(tg.dataset.t || '');
    input.focus();
  });

  /* ---- 输入 ---- */
  input.addEventListener('input', () => paintSuggest(input.value));

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // 输入框里有字就当新标签；空的就选第一个建议，省得再去点
      if (input.value.trim()) add(input.value);
      else if (list.length) add(list[0]);
      return;
    }
    if (e.key === 'Backspace' && !input.value && selected.length) {
      e.preventDefault();
      remove(selected[selected.length - 1]);
    }
  });

  return {
    set(tags: string[]): void {
      selected = tags.filter(Boolean);
      input.value = '';
      paintChips();
      paintSuggest('');
    },
    get(): string[] {
      // 输入框里还没回车的半截文字也算进去，避免用户以为加上了其实没加
      const pending = input.value.trim();
      return pending && !selected.includes(pending) ? [...selected, pending] : selected.slice();
    }
  };
}
