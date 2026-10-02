import { RateMeter } from '@/shared/lib/rate-meter';
import type { PlanMsg } from '@/shared/proto/messages';

export interface PlanProgress {
  seq: number;
  first: number;
  expected: number;
  throttle: number;
  received: number;
  startedAt: number;
  finishedAt: number | null;
}

/** What one opened image has cost: bytes and brushes for its handle, plan progress, first paint. */
export class ImageTelemetry {
  readonly meter = new RateMeter();
  deliveries = 0;
  firstDeliveryMs: number | null = null;
  plan: PlanProgress | null = null;
  plans = 0;
  cancelled = 0;
  /** Brushes the server gave up on (ADR-06 IRRECUPERABLES): their area stays at the parent density. */
  unrecoverable = 0;

  constructor(
    readonly handle: number,
    readonly openedAt: number,
  ) {}

  onDelivery(bytes: number, delivery: number, now: number): void {
    this.meter.record(bytes, now);
    this.deliveries += 1;
    if (this.firstDeliveryMs === null) this.firstDeliveryMs = now - this.openedAt;
    if (this.plan && delivery >= this.plan.first) this.plan.received += 1;
  }

  onPlan(p: PlanMsg, now: number): void {
    if (p.event === 0) {
      this.plans += 1;
      this.unrecoverable += p.unrecoverable?.length ?? 0;
      this.plan = {
        seq: p.gazeSeq, first: p.first, expected: p.expectedCount, throttle: p.throttle,
        received: 0, startedAt: now, finishedAt: null,
      };
    } else if (p.event === 1) {
      if (this.plan && this.plan.finishedAt === null) this.plan.finishedAt = now;
    } else {
      this.cancelled += p.cancelled.length;
    }
  }
}
