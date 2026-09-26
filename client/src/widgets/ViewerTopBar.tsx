import { Icon } from '@/shared/ui/Icon';
import styles from './ViewerTopBar.module.css';

export interface ViewerTopBarProps {
  title: string;
  dims: string;
  mp: string;
  counter: string;
  infoActive: boolean;
  telemetryActive: boolean;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleInfo: () => void;
  onToggleTelemetry: () => void;
}

export function ViewerTopBar({
  title,
  dims,
  mp,
  counter,
  infoActive,
  telemetryActive,
  onBack,
  onPrev,
  onNext,
  onToggleInfo,
  onToggleTelemetry,
}: ViewerTopBarProps): JSX.Element {
  return (
    <div className={styles.topBar}>
      <div className={`glass-pill ${styles.titlePill}`}>
        <button
          onClick={onBack}
          title="Back to library (Esc)"
          className={`visor-btn ${styles.backBtn}`}
        >
          <Icon name="arrow_back" size={24} />
        </button>
        <div className={styles.titleBox} title={`${title} · ${dims} px · ${mp}`}>
          <span className={styles.titleText}>{title}</span>
          <span className={styles.subText}>{dims} px · {mp}</span>
        </div>
      </div>
      <div className={`glass-pill ${styles.navPill}`}>
        <button
          onClick={onPrev}
          title="Previous ([)"
          className={`visor-btn ${styles.navBtn}`}
        >
          <Icon name="chevron_left" size={24} />
        </button>
        <span className={styles.counter}>{counter}</span>
        <button
          onClick={onNext}
          title="Next (])"
          className={`visor-btn ${styles.navBtn}`}
        >
          <Icon name="chevron_right" size={24} />
        </button>
        <div className={styles.divider} />
        <button
          onClick={onToggleTelemetry}
          title="Telemetry (T)"
          className={`visor-btn-spring ${styles.infoBtn} ${telemetryActive ? styles.infoBtnActive : ''}`}
        >
          <Icon name="bar_chart" size={24} />
        </button>
        <button
          onClick={onToggleInfo}
          title="Details (I)"
          className={`visor-btn-spring ${styles.infoBtn} ${infoActive ? styles.infoBtnActive : ''}`}
        >
          <Icon name="info" size={24} />
        </button>
      </div>
    </div>
  );
}
