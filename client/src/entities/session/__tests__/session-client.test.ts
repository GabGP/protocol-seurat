import { describe, expect, it } from 'vitest';
import { SessionClient } from '../client/session-client';
import { encodeFrame } from '@/shared/proto/frame';
import {
  T,
  welcomeCore,
  welcomeTlvs,
  heartbeatCore,
  workCore,
  openedCore,
  concessionCore,
  planCore,
  echoDecode,
  openDecode,
  receiptDecode,
  releaseDecode,
  inventoryDecode,
  type Regulation,
} from '@/shared/proto/messages';
import { concat, viDecode } from '@/shared/proto/varint';
import type { SeuratTransport } from '@/shared/api/transport';

function mockTransport() {
  const sentControl: Uint8Array[] = [];
  const t: SeuratTransport = {
    name: 'websocket',
    supportsDatagrams: false,
    onControl: null,
    onDelivery: null,
    onClose: null,
    sendControl(f: Uint8Array) {
      sentControl.push(f);
    },
    sendGazeDatagram() {},
    close() {},
  };
  return { t, sentControl };
}

describe('SessionClient', () => {
  it('replies to LATIDO with ECO nonce', () => {
    const { t, sentControl } = mockTransport();
    const events = {
      onWelcome: () => {},
      onWork: () => {},
      onWorkOpened: () => {},
      onConcession: () => {},
      onPlan: () => {},
      onScrape: () => {},
      onRenew: () => {},
      onAudit: () => {},
      onProtocolError: () => {},
      onDelivery: () => {},
      onStatus: () => {},
    };
    const client = new SessionClient(events);
    // wire transport
    (client as unknown as { transport: SeuratTransport }).transport = t;
    (client as unknown as { wire(t: SeuratTransport): void }).wire(t);

    const nonce = 0x123456789abcdef0n;
    const heartbeatFrame = encodeFrame(T.LATIDO, heartbeatCore(nonce));
    t.onControl?.(heartbeatFrame);

    expect(sentControl.length).toBe(1);
    const reply = sentControl[0];
    expect(reply).toBeDefined();
    // reply is ECO
    const s = viDecode(reply!, 0);
    expect(s.value).toBe(T.ECO);
    const payload = reply!.slice(s.next + 1); // skip length varint
    expect(echoDecode(payload)).toBe(nonce);
  });

  it('dispatches BIENVENIDA, OBRA, ABIERTA, CONCESION, PLAN', () => {
    const { t } = mockTransport();
    let welcomeOk = false;
    let workOk = false;
    let openedOk = false;
    let concessionOk = false;
    let planOk = false;

    const events = {
      onWelcome: () => { welcomeOk = true; },
      onWork: () => { workOk = true; },
      onWorkOpened: () => { openedOk = true; },
      onConcession: () => { concessionOk = true; },
      onPlan: () => { planOk = true; },
      onScrape: () => {},
      onRenew: () => {},
      onAudit: () => {},
      onProtocolError: () => {},
      onDelivery: () => {},
      onStatus: () => {},
    };
    const client = new SessionClient(events);
    (client as unknown as { transport: SeuratTransport }).transport = t;
    (client as unknown as { wire(t: SeuratTransport): void }).wire(t);

    const b = {
      version: 1, caps: 3, sessionId: 100n, lado: 256, leaseS: 120,
      heartbeatS: 15, maxInFlight: 12, sessionMaxBrushes: 1024, ticket: new Uint8Array(32), resumed: [],
    };
    t.onControl?.(encodeFrame(T.BIENVENIDA, concat(welcomeCore(b), ...welcomeTlvs(b))));
    expect(welcomeOk).toBe(true);

    t.onControl?.(encodeFrame(T.OBRA, workCore({
      event: 1, state: 3, progress: 100, edition: 1, width: 1000, height: 1000, strata: 10, id: 'test', name: 'Test',
    })));
    expect(workOk).toBe(true);

    t.onControl?.(encodeFrame(T.ABIERTA, openedCore({
      handle: 1, width: 1000, height: 1000, strata: 10, edition: 1, ceilingStratum: 0, ceilingBands: 4, seedWidth: 192, seedHeight: 160,
    })));
    expect(openedOk).toBe(true);

    t.onControl?.(encodeFrame(T.CONCESION, concessionCore({
      handle: 1, epoch: 1, minStratum: 7, maxBands: 4, reason: 0, maxBrushes: 768, maxKiB: 36864, leaseS: 120,
    })));
    expect(concessionOk).toBe(true);

    t.onControl?.(encodeFrame(T.PLAN, planCore({
      handle: 1, gazeSeq: 1, event: 0, first: 1, expectedCount: 10, throttle: 0,
    })));
    expect(planOk).toBe(true);
  });

  it('sends outgoing control messages properly', () => {
    const { t, sentControl } = mockTransport();
    const client = new SessionClient({
      onWelcome: () => {}, onWork: () => {}, onWorkOpened: () => {}, onConcession: () => {},
      onPlan: () => {}, onScrape: () => {}, onRenew: () => {}, onAudit: () => {},
      onProtocolError: () => {}, onDelivery: () => {}, onStatus: () => {},
    });
    (client as unknown as { transport: SeuratTransport }).transport = t;

    client.openWork('work-42');
    expect(sentControl.length).toBe(1);
    expect(openDecode(sentControl[0]!.slice(2))).toBe('work-42');

    client.sendReceipt(1, [1, 2, 3], 20, 700, 5);
    expect(sentControl.length).toBe(2);
    const rec = receiptDecode(sentControl[1]!.slice(2));
    expect(rec.handle).toBe(1);
    expect(rec.queueMs).toBe(20);
    expect(rec.free).toBe(700);

    client.sendRelease(1, 1, [4, 5]);
    expect(sentControl.length).toBe(3);
    const sol = releaseDecode(sentControl[2]!.slice(2));
    expect(sol.reason).toBe(1);
    expect(sol.ranges).toEqual([4, 5]);

    client.sendInventory(1, 2, 10, 5, 200, [1, 2, 3]);
    expect(sentControl.length).toBe(4);
    const inv = inventoryDecode(sentControl[3]!.slice(2));
    expect(inv.brushCount).toBe(5);
    expect(inv.kib).toBe(200);
  });

  it('routes a frame of type 0x40 REGULACION (ADR-07) and does not fail the session', () => {
    const { t } = mockTransport();
    let reg: Regulation | null = null;
    let failed = false;

    const events = {
      onWelcome: () => {},
      onWork: () => {},
      onWorkOpened: () => {},
      onConcession: () => {},
      onPlan: () => {},
      onScrape: () => {},
      onRenew: () => {},
      onAudit: () => {},
      onProtocolError: () => { failed = true; },
      onDelivery: () => {},
      onStatus: () => {},
      onRegulation: (g: Regulation) => { reg = g; },
    };
    const client = new SessionClient(events);
    (client as unknown as { transport: SeuratTransport }).transport = t;
    (client as unknown as { wire(t: SeuratTransport): void }).wire(t);

    const payload = Uint8Array.from([0x01, 0x48, 0x00, 0x80, 0x00, 0x60, 0x00, 0x10]);
    t.onControl?.(encodeFrame(0x40, payload));

    expect(failed).toBe(false);
    expect(client.failed).toBe(false);
    expect(reg).toEqual({ rung: 1, budgetKibS: 2048, capacityKibS: 24576, sessions: 16 });
  });
});
