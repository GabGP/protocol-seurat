import type { Regulation } from '@/shared/proto/messages';
import { dotsPerSide } from '@/widgets/viewer-canvas';
import { LoadError, RegulationNotice, SlowScriptNotice } from '@/widgets/viewer-status';
import { Icon } from '@/shared/ui/Icon';
import { ICON_SM } from '@/shared/config/icon';
import styles from './ViewerPage.module.css';

interface Props {
  inDots: boolean;
  /** Screen px per image px, for the dots-per-pixel count. */
  s: number;
  loading: boolean;
  title: string;
  dims: string;
  err: boolean;
  regulation: Regulation | null;
  onRetry: () => void;
}

/** The banners over the canvas: pointillist view, server load, loading, load error, slow script. */
export function ViewerNotices({ inDots, s, loading, title, dims, err, regulation, onRetry }: Props): JSX.Element {
  return (
    <>
      {inDots && (
        <div className={styles.pointillistBanner}>
          <Icon name="blur_on" size={ICON_SM} />Pointillist view · each pixel = {dotsPerSide(s) ** 2} dots
        </div>
      )}
      <RegulationNotice regulation={regulation} />
      {loading && <div className={styles.loadingNotice}>Loading {title} · {dims} px</div>}
      {err && <LoadError onRetry={onRetry} />}
      <SlowScriptNotice />
    </>
  );
}
