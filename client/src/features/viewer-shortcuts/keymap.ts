import { KEY_PAN_STEP_PX, ZOOM_STEP_FACTOR } from '@/shared/config/view';

/** Viewer commands the page owns (panels, navigation). */
export interface ShortcutActions {
  onToggleLoupe(): void;
  onDiveDots(): void;
  onToggleInfo(): void;
  onToggleTelemetry(): void;
  onToggleSettings(): void;
  onPrev(): void;
  onNext(): void;
  onBack(): void;
  onCloseMenu(): void;
}

/** What the keys can do to the view. */
export interface ShortcutHost {
  actions(): ShortcutActions;
  /** Zoom (about the centre) to the scale `next` derives from the current target scale. */
  zoomFrom(next: (ts: number) => number): void;
  zoomTo(scale: number): void;
  fit(immediate: boolean): void;
  /** Shift the view target by this many CSS px. */
  nudge(dx: number, dy: number): void;
}

type Command = (h: ShortcutHost) => void;

const zoomIn: Command = (h) => h.zoomFrom((ts) => ts * ZOOM_STEP_FACTOR);
const zoomOut: Command = (h) => h.zoomFrom((ts) => ts / ZOOM_STEP_FACTOR);
const act =
  (pick: (a: ShortcutActions) => () => void): Command =>
  (h) => pick(h.actions())();

/** The one key table. Letters are matched case-insensitively (see `commandFor`). */
export const KEYMAP: ReadonlyMap<string, Command> = new Map<string, Command>([
  ['+', zoomIn],
  ['=', zoomIn],
  ['-', zoomOut],
  ['_', zoomOut],
  ['0', (h) => h.fit(false)],
  ['1', (h) => h.zoomTo(1)],
  ['ArrowLeft', (h) => h.nudge(KEY_PAN_STEP_PX, 0)],
  ['ArrowRight', (h) => h.nudge(-KEY_PAN_STEP_PX, 0)],
  ['ArrowUp', (h) => h.nudge(0, KEY_PAN_STEP_PX)],
  ['ArrowDown', (h) => h.nudge(0, -KEY_PAN_STEP_PX)],
  ['l', act((a) => a.onToggleLoupe)],
  ['p', act((a) => a.onDiveDots)],
  ['i', act((a) => a.onToggleInfo)],
  ['t', act((a) => a.onToggleTelemetry)],
  ['s', act((a) => a.onToggleSettings)],
  ['[', act((a) => a.onPrev)],
  [']', act((a) => a.onNext)],
  ['Escape', act((a) => a.onBack)],
]);

export const commandFor = (key: string): Command | undefined => KEYMAP.get(key) ?? KEYMAP.get(key.toLowerCase());
