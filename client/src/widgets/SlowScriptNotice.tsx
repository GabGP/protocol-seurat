import { useEffect, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { scriptLooksUnoptimized } from '@/shared/lib/script-speed';
import { SCRIPT_PROBE_DELAY_MS } from '@/shared/config/script-speed';
import styles from './SlowScriptNotice.module.css';

/** Probed once per page load; a dismissal lasts until the page is reloaded. */
let verdict: boolean | null = null;
let dismissed = false;

export function SlowScriptCard({ onDismiss }: { onDismiss(): void }): JSX.Element {
  return (
    <div className={styles.card} role="status">
      <Icon name="info" size={20} className={styles.icon} />
      <span className={styles.message}>
        This browser is running JavaScript without optimizations on this site, so images decode slowly
        and use much more CPU. Allow this site in your browser&apos;s security settings (for example, add
        it as an exception), then reload.
      </span>
      <button onClick={onDismiss} className={styles.close} aria-label="Dismiss" title="Dismiss">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

/**
 * Warns when the browser runs this page without its JavaScript optimizer (the decode workers slow
 * down by an order of magnitude). Probes only while the tab is visible: hidden tabs are throttled.
 */
export function SlowScriptNotice(): JSX.Element | null {
  const [show, setShow] = useState(verdict === true && !dismissed);
  useEffect(() => {
    if (verdict !== null) return;
    let timer = 0;
    const run = (): void => {
      if (document.visibilityState !== 'visible') return; // re-armed when the tab is shown again
      document.removeEventListener('visibilitychange', arm);
      verdict = scriptLooksUnoptimized();
      setShow(verdict && !dismissed);
    };
    function arm(): void {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, SCRIPT_PROBE_DELAY_MS);
    }
    document.addEventListener('visibilitychange', arm);
    arm();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', arm);
    };
  }, []);
  if (!show) return null;
  return <SlowScriptCard onDismiss={() => { dismissed = true; setShow(false); }} />;
}
