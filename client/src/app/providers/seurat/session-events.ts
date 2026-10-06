import { clearResume, type SessionEvents } from '@/entities/session';
import { applyWork, sortWorks } from '@/entities/work';
import { ErrorCode, RUNG_NORMAL } from '@/shared/config/constants';
import { T } from '@/shared/proto/messages';
import { showPreviews } from './preview-cards';
import type { Reconnect } from './reconnect';
import { bookEvents } from './route-book-messages';
import { deliveryEvents } from './route-delivery';
import type { Runtime } from './runtime';
import { dropSink, openSink, retireSink } from './sink-lifecycle';

/** 12: resume rejected; 4 after a RASPAR TODO: the work was withdrawn and the handle is dead (spec 7.4). */
function handleIsDead(rt: Runtime, code: number, refType: number): boolean {
  return code === ErrorCode.RESUME_REJECTED
    || (code === ErrorCode.NO_SUCH_WORK && refType !== T.ABRIR && rt.sink?.withdrawn === true);
}

/** Every server-to-app callback, wired to the runtime; `reconnect` answers a lost connection. */
export function createEvents(rt: Runtime, reconnect: Reconnect): SessionEvents {
  return {
    ...bookEvents(rt),
    ...deliveryEvents(rt),
    onRegulation: (g) => {
      rt.regulation = g.budgetKibS === 0 && g.rung === RUNG_NORMAL ? null : g;
      if (rt.alive) rt.ui.setRegulation(rt.regulation);
    },
    onWelcome: (b) => {
      rt.regulation = null;
      if (rt.alive) rt.ui.setRegulation(null);
      reconnect.welcomed();
      const kept = rt.resuming !== null && b.resumed.includes(rt.resuming) && rt.sink?.handle === rt.resuming;
      rt.resuming = null;
      if (kept) {
        rt.sink?.resumed(); // spec 3.4.4: the book is adopted, nothing is downloaded again
        rt.gaze?.again();
        return;
      }
      if (rt.sink) {
        retireSink(rt, false); // not adopted: empty the canvas, the viewer reopens it from the sketch
        rt.ui.setWorkOpened(null);
      }
      if (rt.alive) rt.ui.setWelcome(b);
    },
    onDisconnect: reconnect.run,
    onSessionInfo: (s) => {
      if (rt.alive) rt.ui.setSession(s);
    },
    onWork: (m) => {
      rt.works = applyWork(rt.works, m);
      const list = sortWorks([...rt.works.values()]);
      if (!rt.alive) return;
      rt.ui.setWorks(list);
      showPreviews(rt);
    },
    onWorkOpened: (a) => {
      if (rt.alive) openSink(rt, a);
    },
    onPreviewWorkOpened: (id, a) => rt.preview?.onWorkOpened(id, a),
    onPreviewError: (id) => rt.preview?.onError(id),
    onProtocolError: (e) => {
      if (handleIsDead(rt, e.code, e.refType)) {
        clearResume();
        dropSink(rt);
      }
      if (rt.alive) rt.ui.setLastError(e);
    },
    onStatus: (s) => {
      if (rt.alive) rt.ui.setStatus(s);
    },
  };
}
