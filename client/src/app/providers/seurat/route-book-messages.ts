import type { SessionEvents } from '@/entities/session';
import type { Runtime } from './runtime';

type BookEvents = Pick<SessionEvents, 'onConcession' | 'onPlan' | 'onScrape' | 'onRenew' | 'onAudit'>;

const now = (): number => performance.now();

/**
 * The messages that address one handle's book: the open canvas' sink answers for its own handle,
 * the retired ledgers for an earlier one, the preview manager for a gallery thumbnail.
 */
export function bookEvents(rt: Runtime): BookEvents {
  return {
    onConcession: (c) => {
      if (rt.sink && rt.sink.handle !== c.handle) return;
      rt.concession = c;
      rt.sink?.concede({ epoch: c.epoch, minStratum: c.minStratum, maxBands: c.maxBands });
      if (rt.alive) rt.ui.setConcession(c);
    },
    onPlan: (p) => {
      if (rt.telemetry?.handle === p.handle) rt.telemetry.onPlan(p, now());
      if (rt.sink?.handle === p.handle) {
        rt.sink.planned(p.gazeSeq);
        if (p.event === 0) rt.sink.planStart(p.first, p.gazeSeq);
        if (rt.alive) rt.ui.setPlan(p);
        if (p.event === 2) rt.sink?.applyPlanCanceladas(p.cancelled);
      } else if (p.event === 2) {
        rt.ledgers.canceladas(p.handle, p.cancelled);
      }
    },
    onScrape: (r) => {
      if (rt.preview?.onScrape(r)) return;
      if (rt.sink?.handle === r.handle) {
        rt.sink.applyScrape(r, now);
        if (rt.alive) rt.bumpPaint();
      } else {
        const res = rt.ledgers.applyScrape(r);
        rt.client?.sendScraped(r.handle, r.order, r.epoch, r.through, res.scraped, res.kib, res.keep);
      }
    },
    onRenew: (r) => {
      if (rt.preview?.onRenew(r)) return;
      if (rt.sink?.handle !== r.handle) return;
      rt.sink?.applyRenew(r.ranges, r.order, r.leaseS, now);
    },
    onAudit: (a) => {
      if (rt.preview?.onAudit(a)) return;
      const inv = rt.sink?.handle === a.handle ? rt.sink?.inventory(a.through) : rt.ledgers.inventory(a.handle, a.through);
      if (inv && rt.client) rt.client.sendInventory(a.handle, a.order, a.through, inv.brushCount, inv.kib, inv.ranges);
    },
  };
}
