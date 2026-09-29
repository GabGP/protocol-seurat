import { Slider } from '@/shared/ui/Slider';
import { Menu } from '@/shared/ui/Menu';
import { Icon } from '@/shared/ui/Icon';
import type { ZoomPreset } from '@/features/zoom-view';
import { ZoomMenu } from './ZoomMenu';
import styles from './ViewerToolbar.module.css';
import { ICON_LG, ICON_MD } from '@/shared/config/icon';

interface Props {
  pctLabel: string;
  frac: number;
  menu: boolean;
  presets: ZoomPreset[];
  loupe: boolean | { bg: string; fg: string; r: string };
  dots: boolean | { bg: string; fg: string; r: string };
  onZoomIn(): void;
  onZoomOut(): void;
  onSlide(f: number): void;
  onToggleMenu(): void;
  onPreset(p: ZoomPreset): void;
  onFit(): void;
  onOneToOne(): void;
  onToggleLoupe(): void;
  onDiveDots(): void;
}

export function ViewerToolbar(p: Props): JSX.Element {
  const loupeActive = typeof p.loupe === 'boolean' ? p.loupe : p.loupe.bg !== 'transparent';
  const dotsActive = typeof p.dots === 'boolean' ? p.dots : p.dots.bg !== 'transparent';

  return (
    <div className={styles.toolbar}>
      <button onClick={p.onZoomOut} title="Zoom out (−)" className={`visor-btn ${styles.toolButton} ${styles.zoomOutBtn}`}>
        <Icon name="remove" size={ICON_LG} />
      </button>
      <div className={styles.sliderContainer}>
        <Slider frac={p.frac} onSeek={p.onSlide} />
      </div>
      <button onClick={p.onZoomIn} title="Zoom in (+)" className={`visor-btn ${styles.toolButton} ${styles.zoomInBtn}`}>
        <Icon name="add" size={ICON_LG} />
      </button>
      <div className={styles.menuAnchor}>
        <button onClick={p.onToggleMenu} title="Zoom levels" className={`visor-btn ${styles.zoomButton}`}>
          {p.pctLabel}<Icon name="arrow_drop_down" size={ICON_MD} />
        </button>
        <Menu open={p.menu}>
          <ZoomMenu presets={p.presets} onPick={p.onPreset} />
        </Menu>
      </div>
      <div className={styles.divider} />
      <button onClick={p.onFit} title="Fit to screen (0)" className={`visor-btn ${styles.toolButton}`}>
        <Icon name="fit_screen" size={ICON_LG} />
      </button>
      <button onClick={p.onOneToOne} title="Actual pixels (1)" className={`visor-btn ${styles.oneToOneButton}`}>
        1:1
      </button>
      <div className={styles.divider} />
      <button
        onClick={p.onToggleLoupe}
        title="Loupe (L)"
        className={`visor-btn-spring ${styles.toolButton} ${loupeActive ? styles.activeToolButton : ''}`}
      >
        <Icon name="search" size={ICON_LG} />
      </button>
      <button
        onClick={p.onDiveDots}
        title="Dive into the dots (P)"
        className={`visor-btn-spring ${styles.toolButton} ${dotsActive ? styles.activeToolButton : ''}`}
      >
        <Icon name="blur_on" size={ICON_LG} />
      </button>
    </div>
  );
}
