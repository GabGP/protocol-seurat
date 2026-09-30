import { describe, expect, it, vi } from 'vitest';
import { bookEvents } from '../providers/seurat/route-book-messages';
import type { Runtime } from '../providers/seurat/runtime';
import type { PlanMsg } from '@/shared/proto/messages';

describe('bookEvents routing', () => {
  it('calls rt.sink.planned(gazeSeq) on matching handle for plan events', () => {
    const planned = vi.fn();
    const planStart = vi.fn();
    const sink = { handle: 42, planned, planStart } as unknown as Runtime['sink'];
    const telemetryPlan = vi.fn();
    const telemetry = { handle: 42, onPlan: telemetryPlan } as unknown as Runtime['telemetry'];
    const rt = {
      alive: true,
      sink,
      telemetry,
      ui: { setPlan: vi.fn() },
      ledgers: { canceladas: vi.fn() },
    } as unknown as Runtime;

    const events = bookEvents(rt);

    const planInicio: PlanMsg = { handle: 42, gazeSeq: 7, event: 0, first: 1, expectedCount: 2, throttle: 0 };
    events.onPlan(planInicio);

    expect(planned).toHaveBeenCalledWith(7);
    expect(planStart).toHaveBeenCalledWith(1, 7);
    expect(telemetryPlan).toHaveBeenCalled();

    // Different handle does not invoke sink.planned
    planned.mockClear();
    const otherPlan: PlanMsg = { handle: 99, gazeSeq: 8, event: 1, last: 5 };
    events.onPlan(otherPlan);
    expect(planned).not.toHaveBeenCalled();
  });
});
