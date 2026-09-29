import { ChoiceGroup } from '@/shared/ui/ChoiceGroup';
import { deviceDpr } from '@/shared/lib/dpr';
import { useFeed, type Feed } from '@/shared/lib/feed';
import { setRenderScale, useRenderFlags } from '@/shared/lib/render-flags';
import { SCALE_CHOICES, scaleStatus } from '../model/scale-choices';
import styles from './RenderScaleSection.module.css';

interface Props {
  /** The canvas's CSS size, published by the viewer. */
  size: Feed<{ w: number; h: number } | null>;
}

/** Render scale: how many backing pixels per CSS pixel the canvas draws; the server sees the same device px in MIRADA. */
export function RenderScaleSection({ size }: Props): JSX.Element {
  const { scale } = useRenderFlags();
  const css = useFeed(size);
  return (
    <section className={styles.section} aria-label="Render scale">
      <span className={styles.sectionTitle}>Render scale</span>
      <ChoiceGroup label="Render scale" choices={SCALE_CHOICES} value={scale} onChange={setRenderScale} />
      <span className={styles.hint}>{scaleStatus(scale, css, deviceDpr())}</span>
    </section>
  );
}
