import { commandFor, type ShortcutHost } from './keymap';

/** Runs the command a key is bound to. Typing in a field is left alone. Returns whether it was handled. */
export function handleKey(e: KeyboardEvent, host: ShortcutHost): boolean {
  const t = e.target as HTMLElement | null;
  if (t && /INPUT|TEXTAREA/.test(t.tagName)) return false;
  const cmd = commandFor(e.key);
  if (!cmd) return false;
  cmd(host);
  e.preventDefault();
  return true;
}

/** Listens on the window; the returned function stops. */
export function attachShortcuts(host: ShortcutHost): () => void {
  const onKey = (e: KeyboardEvent): void => void handleKey(e, host);
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
