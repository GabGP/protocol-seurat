import { useEffect, useRef, useState } from 'react';
import { createChromeState, type ChromeProps } from '../model/chrome-types';
import { mountChrome } from '../model/mount-chrome';
import styles from './ViewerChrome.module.css';

export function ViewerChrome(props: ChromeProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createChromeState());
  const propsRef = useRef(props);
  propsRef.current = props;
  const wakeRef = useRef<() => void>(() => undefined);
  const meterRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  /** Bumped to remount the canvas: a canvas keeps its first context type (WebGL2 ↔ Canvas2D). */
  const [canvasGen, setCanvasGen] = useState(0);
  /** WebGL2 failed or lost its context for good on this viewer: Canvas2D until the switch is flipped again. */
  const gpuFailed = useRef(false);
  /** Bumped when a lost WebGL context is restored: a new renderer on the same canvas and context. */
  const [glGen, setGlGen] = useState(0);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    return mountChrome({
      cv,
      st: stateRef.current,
      P: () => propsRef.current,
      wake: wakeRef,
      meterEl: () => meterRef.current,
      badgeEl: () => badgeRef.current,
      gpuFailed,
      remountCanvas: () => setCanvasGen((g) => g + 1),
      contextRestored: () => setGlGen((g) => g + 1),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.iw, props.ih, props.handle, canvasGen, glGen]);

  // New deliveries and renderer toggles must repaint even when the view is idle.
  useEffect(() => {
    wakeRef.current();
  }, [props.paintTick, props.sink, props.loupe, props.dotThreshold, props.maxZoom]);

  return (
    <>
      <canvas
        key={canvasGen}
        ref={canvasRef}
        className={`${styles.canvas} ${props.loupe ? styles.cursorCrosshair : styles.cursorGrab}`}
      />
      <div ref={meterRef} className={styles.meter} aria-live="off" hidden />
      <div ref={badgeRef} className={styles.loupeBadge} aria-hidden="true" hidden />
    </>
  );
}
