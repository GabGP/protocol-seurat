import { describe, expect, it } from 'vitest';
import { SessionClient } from '@/entities/session';
import { DeliverySink } from '@/entities/delivery';
import { encodeFrame } from '@/shared/proto/frame';
import {
  T,
  welcomeCore,
  welcomeTlvs,
  workCore,
  openedCore,
  concessionCore,
  planCore,
  scrapeCore,
  auditCore,
  openDecode,
  scrapedDecode,
  inventoryDecode,
  releaseDecode,
  type WorkMessage,
} from '@/shared/proto/messages';
import { makeBrushId } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { concat, viDecode } from '@/shared/proto/varint';
import type { SeuratTransport } from '@/shared/api/transport';

const BAND = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const QUALITY = 10;

const makeBrushBytes = (handle: number, delivery: number, brushId: bigint): Uint8Array =>
  makeDeliveryBytes({ handle, delivery, brushId, from: 0, through: 1, epoch: 1, qY: QUALITY, qC: QUALITY, band: BAND });

describe('End-to-End Protocol Flow Integration', () => {
  it('executes full session, catalog, open, delivery, audit, and eviction cycle', async () => {
    const sentControl: Uint8Array[] = [];
    const sentGazes: Uint8Array[] = [];

    const transport: SeuratTransport = {
      name: 'websocket',
      supportsDatagrams: false,
      onControl: null,
      onDelivery: null,
      onClose: null,
      sendControl(f: Uint8Array) {
        sentControl.push(f);
      },
      sendGazeDatagram(d: Uint8Array) {
        sentGazes.push(d);
      },
      close() {},
    };

    const works: WorkMessage[] = [];
    let activeHandle: number | null = null;
    let activeEpoch: number | null = null;

    let sink!: DeliverySink;
    const client = new SessionClient({
      onWelcome: () => {},
      onWork: (o) => works.push(o),
      onWorkOpened: (a) => {
        activeHandle = a.handle;
      },
      onConcession: (c) => {
        activeEpoch = c.epoch;
      },
      onPlan: () => {},
      onScrape: (r) => sink.applyScrape(r, () => performance.now()),
      onRenew: (r) => sink.applyRenew(r.ranges, r.order, r.leaseS, () => performance.now()),
      onAudit: (a) => {
        const inv = sink.inventory(a.through);
        client.sendInventory(a.handle, a.order, a.through, inv.brushCount, inv.kib, inv.ranges);
      },
      onProtocolError: () => {},
      onDelivery: (d) => sink.ingest(d, () => performance.now(), () => {}, 30),
      onStatus: () => {},
    });

    client.wire(transport);

    sink = new DeliverySink(
      1,
      () => client,
      () => 512,
      () => 128,
      192,
      160,
    );

    // 1. Handshake: BIENVENIDA from server
    const b = {
      version: 1,
      caps: 0x01,
      sessionId: 0xfeedfacecafe0001n,
      lado: 256,
      leaseS: 60,
      heartbeatS: 10,
      maxInFlight: 16,
      sessionMaxBrushes: 1000,
      ticket: new TextEncoder().encode('test-ticket'),
      resumed: [],
    };
    const welcome = encodeFrame(
      T.BIENVENIDA,
      concat(welcomeCore(b), ...welcomeTlvs(b)),
    );
    transport.onControl?.(welcome);

    // 2. Catalog: Server delivers OBRA metadata
    const work1 = encodeFrame(
      T.OBRA,
      workCore({
        event: 1, // ALTA
        state: 3, // DISPONIBLE
        progress: 100,
        edition: 1,
        width: 8000,
        height: 6000,
        strata: 8,
        id: 'work-01',
        name: 'Sunday Afternoon',
      }),
    );
    transport.onControl?.(work1);
    expect(works.length).toBe(1);
    expect(works[0]?.id).toBe('work-01');
    expect(works[0]?.name).toBe('Sunday Afternoon');

    // 3. Open work: Client sends ABRIR
    client.openWork('work-01');
    expect(sentControl.length).toBe(1);
    const openFrame = sentControl[0]!;
    const hType = viDecode(openFrame, 0);
    expect(hType.value).toBe(T.ABRIR);
    expect(openDecode(openFrame.slice(hType.next + 1))).toBe('work-01');

    // Server responds with ABIERTA + initial CONCESION
    transport.onControl?.(
      encodeFrame(
        T.ABIERTA,
        openedCore({
          handle: 1,
          width: 8000,
          height: 6000,
          strata: 8,
          edition: 1,
          seedWidth: 192,
          seedHeight: 160,
        }),
      ),
    );
    expect(activeHandle).toBe(1);

    transport.onControl?.(
      encodeFrame(
        T.CONCESION,
        concessionCore({
          handle: 1,
          epoch: 1,
          minStratum: 0,
          reason: 0,
          maxBrushes: 64,
          maxKiB: 4096,
          leaseS: 30,
        }),
      ),
    );
    expect(activeEpoch).toBe(1);

    // 4. Client reports MIRADA; Server sends PLAN
    transport.sendGazeDatagram(new Uint8Array([1, 2, 3]));
    expect(sentGazes.length).toBe(1);

    transport.onControl?.(
      encodeFrame(
        T.PLAN,
        planCore({
          handle: 1,
          gazeSeq: 1,
          event: 0,
          first: 1,
          expectedCount: 2,
          throttle: 0,
        }),
      ),
    );

    // 5. Stream deliveries into sink
    const pId1 = makeBrushId(7, 0, 0);
    const pId2 = makeBrushId(7, 1, 0);
    sink.ingest(makeBrushBytes(1, 1, pId1), () => performance.now(), () => {}, 30);
    sink.ingest(makeBrushBytes(1, 2, pId2), () => performance.now(), () => {}, 30);

    expect(sink.book.byDelivery.has(1)).toBe(true);
    expect(sink.book.byDelivery.has(2)).toBe(true);

    // 6. Server issues AUDITAR: Client answers with INVENTARIO
    sentControl.length = 0;
    transport.onControl?.(
      encodeFrame(
        T.AUDITAR,
        auditCore({ handle: 1, order: 42, through: 2 }),
      ),
    );

    expect(sentControl.length).toBe(1);
    const invFrame = sentControl[0]!;
    const invType = viDecode(invFrame, 0);
    expect(invType.value).toBe(T.INVENTARIO);
    const inv = inventoryDecode(invFrame.slice(invType.next + 1));
    expect(inv.handle).toBe(1);
    expect(inv.order).toBe(42);
    expect(inv.brushCount).toBe(2);
    expect(inv.ranges).toEqual([1, 2]);

    // 7. Server issues RASPAR with predicate 1 (ESTRATO_MENOR):
    // drop deliveries with stratum < 8 (our deliveries have stratum 7)
    sentControl.length = 0;
    transport.onControl?.(
      encodeFrame(
        T.RASPAR,
        scrapeCore({
          handle: 1,
          order: 99,
          epoch: 1,
          through: 2,
          predicate: 1,
          params: new Uint8Array([8]),
        }),
      ),
    );

    expect(sentControl.length).toBe(1);
    const raspFrame = sentControl[0]!;
    const raspType = viDecode(raspFrame, 0);
    expect(raspType.value).toBe(T.RASPADO);
    const rasp = scrapedDecode(raspFrame.slice(raspType.next + 1));
    expect(rasp.handle).toBe(1);
    expect(rasp.order).toBe(99);
    expect(rasp.scrapedCount).toBe(2);
    expect(rasp.kept).toEqual([]);
    expect(sink.book.byDelivery.size).toBe(0);

    // 8. Lease expiry: add a delivery with past expires timestamp
    sink.ingest(makeBrushBytes(1, 10, pId1), () => performance.now(), () => {}, 30);
    const rec = sink.book.byDelivery.get(10)!;
    rec.expires = performance.now() - 500; // already expired
    sentControl.length = 0;

    // Sweep expiry triggers SOLTAR reason=3
    sink.sweepExpiry(() => performance.now());
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(sentControl.length).toBe(1);
    const releaseFrame = sentControl[0]!;
    const releaseType = viDecode(releaseFrame, 0);
    expect(releaseType.value).toBe(T.SOLTAR);
    const rel = releaseDecode(releaseFrame.slice(releaseType.next + 1));
    expect(rel.handle).toBe(1);
    expect(rel.reason).toBe(3); // CADUCADA
    expect(rel.ranges).toEqual([10]);

    sink.dispose();
  });
});
