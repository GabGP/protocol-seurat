import { Icon } from '@/shared/ui/Icon';
import type { ZoomPreset } from '@/features/zoom-view';
import { ICON_SM } from '@/shared/config/icon';
import styles from './ZoomMenu.module.css';

export function ZoomMenu({ presets, onPick }: { presets: ZoomPreset[]; onPick(p: ZoomPreset): void }): JSX.Element {
  return (
    <>
      {presets.map((p) => (
        <button key={p.label} onClick={() => onPick(p)} className="menu-preset-btn">
          <span>{p.label}</span>
          <span className={styles.note}>
            {p.note}
            {p.on ? <Icon name="check" size={ICON_SM} className={styles.check} /> : null}
          </span>
        </button>
      ))}
    </>
  );
}
