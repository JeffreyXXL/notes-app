import { store, currentNotes, midTitle, trashedNotes, emptyTrash, selectNote, reorderNote } from '../store';
import { esc, hl, excerpt, todoStats, allImages } from '../core/text';
import { formatStamp } from '../core/time';
import { tagStyle } from '../core/tag-color';
import { assetUrl } from '../core/image';
import { ACT_ICON, ICON } from '../icons';
import type { CardAction, Filter, Note } from '../types';
import { doAction, openActions, newNote } from './actions';

let emptyArmed = false;
let emptyTimer: number | null = null;

/* ============================================================
   卡片
   ============================================================ */

function cardActions(n: Note): CardAction[] {
  if (n.trashed) {
    return [
      { k: 'restore', cls: 'undo', label: '恢复', ic: ACT_ICON.undo },
      { k: 'purge', cls: 'del', label: '彻底删除', ic: ACT_ICON.del }
    ];
  }
  // 隐藏的笔记只在「已隐藏」里出现，那边只给「取消隐藏 / 删除」两个动作
  if (n.hidden) {
    return [
      { k: 'unhide', cls: 'undo', label: '取消隐藏', ic: ACT_ICON.unhide },
      { k: 'del', cls: 'del', label: '删除', ic: ACT_ICON.del }
    ];
  }
  const A = store.settings.swipeActs;
  const acts: CardAction[] = [
    { k: 'pin', cls: 'pin', on: A.pin, label: n.pinned ? '取消置顶' : '置顶', ic: ACT_ICON.pin },
    { k: 'archive', cls: 'arc', on: A.archive, label: n.archived ? '移出归档' : '归档', ic: ACT_ICON.archive },
    { k: 'tag', cls: 'tag', on: A.tag, label: '整理', ic: ACT_ICON.tag },
    { k: 'hide', cls: 'hide', on: A.hide, label: '隐藏', ic: ACT_ICON.hide },
    { k: 'del', cls: 'del', on: A.del, label: '删除', ic: ACT_ICON.del }
  ];
  return acts.filter(a => a.on);
}

/**
 * 卡片上那一行目录路径。
 * - 在「全部笔记」里：显示完整路径（技术 / 前端 / React）
 * - 选中某一级目录：只显示它下面的部分；下面没有层级了就整行不显示
 * 所以越往下钻，这行越短，最后自然消失 —— 不会出现「当前目录 / 当前目录」这种废话。
 */
function cardPath(n: Note): string {
  const f = store.state.filter;
  let rel = n.folder;
  if (f && f.type === 'folder' && f.value) {
    if (rel === f.value) return '';
    if (rel.startsWith(f.value + '/')) rel = rel.slice(f.value.length + 1);
  }
  return rel;
}

function cardHTML(n: Note, q: string): string {
  const t = todoStats(n.content);
  const pinFlag = n.pinned
    ? `<span class="pin-flag" title="已置顶">${ACT_ICON.pin}</span>`
    : '';
  const todo = t.total
    ? `<span class="pill todo ${t.done === t.total ? 'done' : ''}">待办 ${t.done}/${t.total}</span>`
    : '';
  const tags = n.tags.slice(0, 2)
    .map(x => `<span class="pill tag" style="${tagStyle(x)}">${esc(x)}</span>`).join('');

  const curView = store.state.filter && store.state.filter.type === 'view' ? store.state.filter.value : '';
  const flag = n.trashed
    ? (curView === 'trash' ? '' : '<span class="pill flag">已删除</span>')
    : n.hidden
      ? (curView === 'hidden' ? '' : '<span class="pill flag">已隐藏</span>')
      : n.archived
        ? (curView === 'archive' ? '' : '<span class="pill flag">已归档</span>')
        : '';

  const more = '<span class="grip" data-grip="1" title="展开操作">···</span>';
  const acts = cardActions(n);
  const actsHTML = acts
    .map(a => `<div class="act ${a.cls}" data-act="${a.k}">${a.ic}<span>${a.label}</span></div>`)
    .join('');

  /* ---- 卡片预览：一段摘要 + 正文里的图（能放几张放几张） ---- */
  const ex = excerpt(n.content, 68);
  const imgPaths = allImages(n.content);
  const path = cardPath(n);

  // 图排成一行，高度都是 96px：
  // 一张图 → 宽度跟着图片自己的比例走，不裁；
  // 多张图 → 均分一行，最多露 3 张，超出的收进右下角的「+N」。
  // 均分是 flex 干的，所以窗口缩放时不用重算。
  const figs = imgPaths.length
    ? `<div class="card-figs ${imgPaths.length > 1 ? 'multi' : 'solo'}">`
      + imgPaths.map(p =>
        `<img class="card-thumb" src="${esc(assetUrl(p, n.folder))}" alt=""
              loading="lazy" draggable="false">`).join('')
      + `<span class="fig-more" style="display:none"></span>`
      + `</div>`
    : '';

  // 有摘要就显示摘要；没有摘要但有图就只留图；
  // 两样都没有，给一句说明，别让卡片空一片 —— 这是「内容不显示」最直观的那一半
  let body: string;
  if (ex) {
    body = `<p>${hl(esc(ex), q)}</p>` + figs;
  } else if (figs) {
    body = figs;
  } else {
    body = '<p class="dim">空白笔记</p>';
  }

  return `<div class="swipe" data-id="${esc(n.id)}" data-nacts="${acts.length}" data-pinned="${n.pinned ? 1 : 0}">
    <div class="swipe-acts">${actsHTML}</div>
    <div class="card ${store.state.selectedId === n.id ? 'active' : ''}">
      <div class="card-top">
        <h4>${hl(esc(n.title), q)}</h4>
        ${pinFlag}
        ${more}
      </div>
      ${path ? `<div class="card-path">${ICON.folder}<span>${esc(path.replace(/\//g, ' / '))}</span></div>` : ''}
      <div class="card-body">${body}</div>
      <div class="meta">${flag}${todo}${tags}<span class="sep">·</span><span>${esc(formatStamp(n.updated))}</span></div>
    </div>
  </div>`;
}

/* ============================================================
   左滑手势 / 操作条
   ============================================================ */

function closeSwipe(w: HTMLElement): void {
  w.classList.remove('open');
  w.classList.remove('dragging');
  const c = w.querySelector<HTMLElement>('.card');
  if (c) c.style.transform = '';
}

export function closeOtherSwipes(keep: HTMLElement | null): void {
  document.querySelectorAll<HTMLElement>('.swipe.open').forEach(w => {
    if (w !== keep) closeSwipe(w);
  });
}

/** 一行里最多露几张缩略图，剩下的收进「+N」 */
const FIG_MAX = 3;

/**
 * 一排缩略图：多图均分一行，最多露 FIG_MAX 张，放不下的收起来，右下角标「+N」。
 *
 * 宽度交给 CSS 的 `flex:1 1 0` 均分，所以这里只数个数、管显示隐藏，
 * 不需要等图片加载完去量 naturalWidth —— 窗口缩放也不会算错。
 */
function syncFigs(box: HTMLElement): void {
  box.querySelectorAll<HTMLElement>('.card-figs').forEach(figs => {
    const imgs = [...figs.querySelectorAll<HTMLImageElement>('img.card-thumb')];
    // 图全都加载失败就把整排撤掉，别在卡片上留一条空带
    if (!imgs.length) { figs.remove(); return; }

    const n = imgs.length;
    const solo = n === 1;
    figs.classList.toggle('solo', solo);
    figs.classList.toggle('multi', !solo);

    // 单图不裁、按自己的比例显示，所以不参与「最多 3 张」的裁剪
    const keep = solo ? 1 : Math.min(n, FIG_MAX);
    imgs.forEach((im, i) => { im.style.display = i < keep ? '' : 'none'; });

    const more = figs.querySelector<HTMLElement>('.fig-more');
    if (!more) return;
    const rest = n - keep;
    if (rest > 0) {
      more.textContent = '+' + rest;
      more.style.display = '';
    } else {
      more.style.display = 'none';
    }
  });
}

function bindCards(box: HTMLElement): void {
  const rows = () => [...box.querySelectorAll<HTMLElement>('.swipe')];

  const clearMarks = () => {
    box.querySelectorAll('.drop-before,.drop-after')
      .forEach(el => el.classList.remove('drop-before', 'drop-after'));
  };

  /**
   * 把落点夹在同一个「置顶分组」里。
   * 置顶的永远排在最前面，允许跨组插入的话松手就会被排序规则弹回去，
   * 所以干脆不让它越界。
   */
  const clampToGroup = (list: HTMLElement[], at: number, pinned: boolean): number => {
    const pinnedCount = list.filter(x => x.dataset.pinned === '1').length;
    return pinned
      ? Math.max(0, Math.min(pinnedCount, at))
      : Math.max(pinnedCount, Math.min(list.length, at));
  };

  box.querySelectorAll<HTMLElement>('.swipe').forEach(w => {
    const card = w.querySelector<HTMLElement>('.card');
    if (!card) return;
    const id = w.dataset.id || '';
    const nacts = Number(w.dataset.nacts || 0);

    const barWidth = () => {
      const acts = w.querySelector<HTMLElement>('.swipe-acts');
      return (acts && acts.offsetWidth) || 54;
    };

    const openBar = () => {
      if (!nacts) return;
      card.style.transition = '';
      card.style.transform = `translateX(${-barWidth()}px)`;
      w.classList.add('open');
      closeOtherSwipes(w);
    };

    const toggleBar = () => {
      if (w.classList.contains('open')) closeSwipe(w);
      else openBar();
    };

    w.querySelectorAll<HTMLElement>('.act').forEach(a => {
      a.addEventListener('click', e => {
        e.stopPropagation();
        closeSwipe(w);
        void doAction(a.dataset.act || '', id);
      });
    });

    // 桌面端：单击卡片右上角 ··· 展开 / 收起操作条
    const grip = w.querySelector<HTMLElement>('[data-grip]');
    if (grip) {
      grip.addEventListener('click', e => {
        e.stopPropagation();
        toggleBar();
      });
    }

    // 右键唤出迷你菜单
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      closeSwipe(w);
      openActions(id);
    });

    /* ---- 指针手势：一次按下只可能是「左滑」或「拖拽排序」之一 ---- */
    let moved = false;
    let mode: 'idle' | 'pending' | 'swipe' | 'order' = 'idle';
    let sx = 0;
    let sy = 0;
    let base = 0;
    let cur = 0;
    let dropAt = -1;

    card.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      sx = e.clientX;
      sy = e.clientY;
      base = w.classList.contains('open') ? -barWidth() : 0;
      cur = base;
      moved = false;
      dropAt = -1;
      mode = 'pending';
      card.style.transition = 'none';
    });

    card.addEventListener('pointermove', e => {
      if (mode === 'idle') return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;

      if (mode === 'pending') {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // 竖向意图明显 → 调整顺序；否则 → 左滑。方向锁一旦定下就不再改
        if (Math.abs(dy) > Math.abs(dx)) {
          mode = 'order';
          w.classList.add('dragging-order');
          closeOtherSwipes(null);
          try { card.setPointerCapture(e.pointerId); } catch { /* 不支持就算了 */ }
        } else if (store.settings.swipe && nacts) {
          mode = 'swipe';
          w.classList.add('dragging');
        } else {
          mode = 'idle';
          card.style.transition = '';
          return;
        }
      }

      if (mode === 'swipe') {
        moved = true;
        cur = Math.min(0, Math.max(-barWidth(), base + dx));
        card.style.transform = `translateX(${cur}px)`;
        return;
      }

      if (mode === 'order') {
        moved = true;
        w.style.transform = `translateY(${dy}px)`;

        const list = rows();
        const self = list.indexOf(w);
        let at = list.length;
        for (let i = 0; i < list.length; i++) {
          if (i === self) continue;
          const r = list[i].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) { at = i; break; }
        }
        at = clampToGroup(list, at, w.dataset.pinned === '1');
        dropAt = at;

        clearMarks();
        if (at < list.length) list[at].classList.add('drop-before');
        else if (list.length) list[list.length - 1].classList.add('drop-after');
      }
    });

    const finish = () => {
      if (mode === 'idle') return;
      const m = mode;
      mode = 'idle';
      w.classList.remove('dragging');
      card.style.transition = '';

      if (m === 'swipe') {
        if (!moved) { card.style.transform = ''; return; }
        const open = cur < -barWidth() * 0.4;
        card.style.transform = open ? `translateX(${-barWidth()}px)` : '';
        w.classList.toggle('open', open);
        if (open) closeOtherSwipes(w);
        return;
      }

      if (m === 'order') {
        w.classList.remove('dragging-order');
        w.style.transform = '';
        clearMarks();
        const at = dropAt;
        dropAt = -1;
        if (moved && at >= 0) void reorderNote(id, at);
      }
    };

    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
    // 左滑时指针划出卡片就收手；拖拽排序靠 pointer capture，不需要这个
    card.addEventListener('pointerleave', () => { if (mode === 'swipe') finish(); });

    card.addEventListener('click', e => {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
      if (w.classList.contains('open')) { e.stopPropagation(); closeSwipe(w); return; }
      selectNote(id);
    });
  });

  // 图片被删掉 / 路径写错时别在卡片上留一个破图标，直接收走
  box.querySelectorAll<HTMLImageElement>('.card-thumb').forEach(img => {
    img.addEventListener('error', () => { img.remove(); syncFigs(box); }, { once: true });
  });

  syncFigs(box);
}

/* ============================================================
   中栏渲染
   ============================================================ */

function renderMidAction(f: Filter | null): void {
  const box = document.getElementById('mid-action');
  if (!box) return;

  const isView = f && f.type === 'view';

  if (isView && f.value === 'trash') {
    box.innerHTML = `<button class="btn sm${emptyArmed ? ' danger' : ''}" id="btn-empty">${emptyArmed ? '确认清空' : '清空'}</button>`;
    box.querySelector('#btn-empty')?.addEventListener('click', () => { void onEmptyTrash(); });
    return;
  }

  emptyArmed = false;
  // 归档 / 已隐藏都是「只读视图」，不给新建按钮
  if (isView && (f.value === 'archive' || f.value === 'hidden')) { box.innerHTML = ''; return; }

  box.innerHTML = '<button class="btn sm" id="btn-new" title="新建笔记（Ctrl+N）">新建笔记</button>';
  box.querySelector('#btn-new')?.addEventListener('click', () => { void newNote(); });
}

/** 清空废纸篓：两段式确认，避免误删 */
async function onEmptyTrash(): Promise<void> {
  if (!trashedNotes().length) return;

  if (!emptyArmed) {
    emptyArmed = true;
    if (emptyTimer) clearTimeout(emptyTimer);
    emptyTimer = window.setTimeout(() => { emptyArmed = false; renderMid(); }, 3000);
    renderMid();
    return;
  }

  if (emptyTimer) clearTimeout(emptyTimer);
  emptyArmed = false;
  await emptyTrash();
}

export function renderMid(): void {
  const list = currentNotes();
  const q = store.state.search.trim();
  const f = store.state.filter;

  const titleEl = document.getElementById('mid-title');
  const countEl = document.getElementById('mid-count');
  if (titleEl) titleEl.textContent = q ? '搜索结果' : midTitle();
  if (countEl) countEl.textContent = q ? `${list.length} 条结果` : `${list.length} 篇`;

  renderMidAction(f);

  const box = document.getElementById('mid-list');
  if (!box) return;

  // 列表还是那一批（reload 之后每次都会整列重绘）：把滚动位置带过去。
  // 换了目录 / 标签 / 搜索词就回到顶部，那才是用户预期的位置。
  const sig = list.map(n => n.id).join('|');
  const keep = box.dataset.sig === sig ? box.scrollTop : 0;
  box.dataset.sig = sig;

  if (!list.length) {
    let msg = '这里还没有笔记';
    if (q) msg = '没有找到匹配的笔记';
    else if (f && f.type === 'view') {
      if (f.value === 'trash') msg = '废纸篓是空的<br>删除的笔记会先放到这里';
      else if (f.value === 'hidden') msg = '没有隐藏的笔记<br>右键笔记选「隐藏这篇笔记」就会收到这里';
      else msg = '还没有归档的笔记';
    }
    box.innerHTML = `<div class="empty-list">${msg}</div>`;
    return;
  }

  box.innerHTML = list.map(n => cardHTML(n, q)).join('');
  bindCards(box);
  if (keep) box.scrollTop = keep;
}
