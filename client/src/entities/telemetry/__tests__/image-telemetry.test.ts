import { describe, expect, it } from 'vitest';
import { ImageTelemetry } from '../image-telemetry';

describe('ImageTelemetry', () => {
  it('raises unrecoverable counter when receiving PLAN INICIO with unrecoverable ids', () => {
    const telemetry = new ImageTelemetry(1, 0);
    expect(telemetry.unrecoverable).toBe(0);
    telemetry.onPlan(
      {
        handle: 1,
        gazeSeq: 1,
        event: 0,
        first: 0,
        expectedCount: 10,
        throttle: 0,
        unrecoverable: [0x010000000000680dn, 0x0200000000001234n],
      },
      100,
    );
    expect(telemetry.unrecoverable).toBe(2);
  });
});
