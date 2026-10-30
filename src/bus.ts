/** 极简事件总线：store 改完数据后通知 UI 重绘，避免 store ↔ ui 循环依赖 */

type Handler = () => void;
const handlers = new Set<Handler>();

export function onChange(fn: Handler): void {
  handlers.add(fn);
}

export function emitChange(): void {
  for (const fn of handlers) fn();
}
