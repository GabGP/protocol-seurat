import { Icon } from '@/shared/ui/Icon';
import { Switch } from '@/shared/ui/Switch';
import {
  DEFAULT_RENDER_FLAGS, resetRenderFlags, setRenderFlag, useRenderFlags, type BooleanFlag, type RenderFlags,
} from '@/shared/lib/render-flags';
import type { Account } from '@/entities/session';
import { CapSection } from '@/features/cap-brushes';
import { RenderScaleSection } from '@/features/render-scale';
import { SignInSection } from '@/features/sign-in';
import type { Feed } from '@/shared/lib/feed';
import styles from './RenderSettingsPanel.module.css';
import { ICON_SM } from '@/shared/config/icon';

interface Option {
  key: BooleanFlag;
  label: string;
  hint: string;
  /** Only meaningful while this other switch is on. */
  needs?: BooleanFlag;
}

const SECTIONS: Array<{ title: string; options: Option[] }> = [
  {
    title: 'Measure',
    options: [{ key: 'fps', label: 'Frame meter', hint: 'Frame rate and frame time, over the canvas' }],
  },
  {
    title: 'Speed',
    options: [
      { key: 'gpu', label: 'GPU renderer (WebGL2)', hint: 'Tiles live in GPU memory and draw in one call; off uses the Canvas2D fallback' },
      { key: 'cull', label: 'Skip hidden tiles', hint: 'Draw only the tiles you can actually see' },
      { key: 'lod', label: 'Smooth zoomed-out detail', needs: 'cull',
        hint: 'Below ~50%, draw the coarser level once it is sharp enough (like mipmaps)' },
      { key: 'blurWhileMoving', label: 'Glass blur while moving', hint: 'Keep the frosted bars blurred during pan and zoom (slower)' },
    ],
  },
  {
    title: 'Look',
    options: [
      { key: 'dots', label: 'Pointillist dots', hint: 'Split pixels into dots above 1200%' },
      { key: 'grid', label: 'Background grid', hint: 'Dotted parallax grid around the image' },
      { key: 'shadow', label: 'Frame shadow', hint: 'Soft shadow under the image edges' },
    ],
  },
];

interface Props {
  onClose(): void;
  /** Who the current session is, shown under Account. */
  account: Account | null;
  /** The open work's ceiling for this viewer's role (ABIERTA), shown under Account. */
  ceiling: { stratum: number; bands: number } | null;
  /** Brushes the server grants this browser, for the Max brushes options. */
  grant: number;
  /** The canvas's CSS size, for the Render scale readout. */
  size: Feed<{ w: number; h: number } | null>;
}

/** Account, then live render switches: every change applies on the next frame and is remembered in this browser. */
export function RenderSettingsPanel({ onClose, account, ceiling, grant, size }: Props): JSX.Element {
  const flags = useRenderFlags();
  const isDefault = (Object.keys(DEFAULT_RENDER_FLAGS) as Array<keyof RenderFlags>)
    .every((k) => flags[k] === DEFAULT_RENDER_FLAGS[k]);
  return (
    <aside className={styles.panel} aria-label="Render settings">
      <div className={styles.header}>
        <span className={styles.title}>Settings</span>
        <button onClick={onClose} title="Close (S)" className={`visor-btn ${styles.closeButton}`}>
          <Icon name="close" size={ICON_SM} />
        </button>
      </div>
      <SignInSection account={account} ceiling={ceiling} />
      <CapSection grant={grant} />
      <RenderScaleSection size={size} />
      {SECTIONS.map((s) => (
        <section key={s.title} className={styles.section}>
          <span className={styles.sectionTitle}>{s.title}</span>
          {s.options.map((o) => (
            <Switch
              key={o.key}
              label={o.label}
              hint={o.hint}
              on={flags[o.key]}
              disabled={o.needs !== undefined && !flags[o.needs]}
              onChange={(v) => setRenderFlag(o.key, v)}
            />
          ))}
        </section>
      ))}
      <button className={styles.reset} disabled={isDefault} onClick={resetRenderFlags}>
        Reset to defaults
      </button>
    </aside>
  );
}
