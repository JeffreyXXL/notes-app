import { store, saveSettings } from '../store';
import { toast } from './links';

/**
 * 密码锁定。
 *
 * 定位先说清楚：这是一把「挡室友 / 挡同事」的锁，不是加密。
 * 笔记本身还是磁盘上的明文 .md，真要拿到文件的人绕得过去。
 * 它的作用是「我离开工位时别让人随手翻」，所以：
 * - 密码只存摘要，不存明文（设置文件被看到也读不出密码）
 * - 摘要算法优先用 WebCrypto 的 SHA-256，环境不支持时退回 FNV-1a
 * - 算法前缀写在摘要里（`s1:` / `f1:`），换环境也能正确校验
 */

let locked = false;
let overlay: HTMLElement | null = null;

/* ============================================================
   摘要
   ============================================================ */

const SALT_KEY = 'notes-lock:';

function randHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // 再滚两轮，把单轮 32 位的碰撞空间拉开一点
  let g = h;
  for (let i = 0; i < s.length; i++) {
    g ^= s.charCodeAt(i) + i;
    g = Math.imul(g, 0x85ebca6b) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + g.toString(16).padStart(8, '0');
}

async function sha256(s: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** 生成 `s1:<salt>:<hex>` 或 `f1:<salt>:<hex>` */
async function makeHash(pw: string): Promise<string> {
  const salt = randHex(8);
  const plain = SALT_KEY + salt + ':' + pw;
  const hex = await sha256(plain);
  return hex ? `s1:${salt}:${hex}` : `f1:${salt}:${fnv1a(plain)}`;
}

async function checkHash(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [algo, salt, want] = parts;
  const plain = SALT_KEY + salt + ':' + pw;

  if (algo === 's1') {
    const hex = await sha256(plain);
    return !!hex && hex === want;
  }
  if (algo === 'f1') return fnv1a(plain) === want;
  return false;
}

/* ============================================================
   锁屏界面
   ============================================================ */

function buildOverlay(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'lock-screen';
  el.id = 'lock-screen';
  el.innerHTML = `
    <div class="lock-card">
      <div class="lock-logo">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <rect x="3.2" y="6.8" width="9.6" height="7" rx="1.8" stroke="currentColor" stroke-width="1.2"/>
          <path d="M5.4 6.8V5a2.6 2.6 0 015.2 0v1.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </div>
      <h3 class="lock-title">已锁定</h3>
      <p class="lock-sub">输入密码继续</p>
      <input class="lock-input" id="lock-input" type="password" placeholder="密码"
        autocomplete="current-password" spellcheck="false">
      <div class="lock-err" id="lock-err"></div>
      <button class="btn primary lock-go" id="lock-go">解锁</button>
    </div>`;
  return el;
}

function showLock(): void {
  if (locked) return;
  locked = true;

  if (!overlay) {
    overlay = buildOverlay();
    document.body.appendChild(overlay);

    const input = overlay.querySelector<HTMLInputElement>('#lock-input')!;
    const go = (): void => { void submit(); };
    overlay.querySelector('#lock-go')?.addEventListener('click', go);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
    });
  }

  overlay.classList.add('show');
  // 等过渡起来再聚焦，否则某些环境里 focus 会被立刻抢走
  setTimeout(() => overlay?.querySelector<HTMLInputElement>('#lock-input')?.focus(), 120);
}

function hideLock(): void {
  locked = false;
  overlay?.classList.remove('show');
  const input = overlay?.querySelector<HTMLInputElement>('#lock-input');
  if (input) input.value = '';
  const err = overlay?.querySelector<HTMLElement>('#lock-err');
  if (err) err.textContent = '';
  // 解锁后把焦点交回搜索框，接着就能用
  document.getElementById('search')?.focus();
}

async function submit(): Promise<void> {
  const input = overlay?.querySelector<HTMLInputElement>('#lock-input');
  const err = overlay?.querySelector<HTMLElement>('#lock-err');
  const card = overlay?.querySelector<HTMLElement>('.lock-card');
  if (!input) return;

  const pw = input.value;
  if (!pw) {
    if (err) err.textContent = '请输入密码';
    return;
  }

  if (await checkHash(pw, store.settings.lockHash)) {
    hideLock();
    return;
  }

  if (err) err.textContent = '密码不对';
  input.value = '';
  input.focus();
  // 抖一下给个物理反馈
  if (card) {
    card.classList.remove('shake');
    void card.offsetWidth; // 强制回流，动画才能重放
    card.classList.add('shake');
  }
}

/* ============================================================
   对外接口
   ============================================================ */

export function isLocked(): boolean {
  return locked;
}

/** 手动锁定：设置里点「锁定」，或以后加快捷键都用这个 */
export function lockNow(): void {
  if (!store.settings.lockEnabled || !store.settings.lockHash) {
    toast('先在设置里开启密码锁定');
    return;
  }
  document.querySelectorAll('.backdrop.open').forEach(b => b.classList.remove('open'));
  showLock();
}

/** 启动时调用：开了锁定就直接盖上 */
export function maybeLockOnBoot(): void {
  if (store.settings.lockEnabled && store.settings.lockHash) showLock();
}

/* ============================================================
   设置密码 / 开启锁定
   ============================================================ */

/**
 * 弹一个「新密码 + 确认」的小窗。
 * 设置成功会顺手把 lockEnabled 打开 —— 用户点「设置密码」的意图
 * 基本就是「我要用这个功能了」，不用再让他多点一次开关。
 */
export function promptSetPassword(): Promise<boolean> {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'lock-screen dialog';
    el.innerHTML = `
      <div class="lock-card">
        <h3 class="lock-title">${store.settings.lockHash ? '修改密码' : '设置密码'}</h3>
        <p class="lock-sub">至少 4 位。忘了密码只能手动改设置文件，请记牢。</p>
        <input class="lock-input" id="pw1" type="password" placeholder="新密码" autocomplete="new-password" spellcheck="false">
        <input class="lock-input" id="pw2" type="password" placeholder="再输一次" autocomplete="new-password" spellcheck="false">
        <div class="lock-err" id="pw-err"></div>
        <div class="lock-actions">
          <button class="btn" id="pw-cancel">取消</button>
          <button class="btn primary" id="pw-ok">确定</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.classList.add('show');

    const a = el.querySelector<HTMLInputElement>('#pw1')!;
    const b = el.querySelector<HTMLInputElement>('#pw2')!;
    const err = el.querySelector<HTMLElement>('#pw-err')!;

    const close = (ok: boolean): void => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 200);
      resolve(ok);
    };

    const ok = async (): Promise<void> => {
      const p1 = a.value;
      const p2 = b.value;
      if (p1.length < 4) { err.textContent = '至少 4 位'; a.focus(); return; }
      if (p1 !== p2) { err.textContent = '两次输入不一致'; b.value = ''; b.focus(); return; }

      store.settings.lockHash = await makeHash(p1);
      store.settings.lockEnabled = true;
      saveSettings();
      // 直接改开关的样式，不 import settings.ts —— 那边要 import 本模块，
      // 来回引会绕成环
      document.getElementById('sw-lock')?.classList.add('on');
      close(true);
    };

    el.querySelector('#pw-ok')?.addEventListener('click', () => { void ok(); });
    el.querySelector('#pw-cancel')?.addEventListener('click', () => close(false));
    el.addEventListener('click', e => { if (e.target === el) close(false); });
    b.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void ok(); } });
    setTimeout(() => a.focus(), 120);
  });
}
