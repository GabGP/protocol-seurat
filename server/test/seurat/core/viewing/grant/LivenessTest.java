package seurat.core.viewing.grant;

import java.nio.ByteBuffer;
import seurat.adapters.in.net.socket.RecordingMapping;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgAudit;
import seurat.core.shared.proto.msg.MsgError;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.store.WorkMeta;
import seurat.kit.ConcessionRig;
import seurat.kit.TestKit;

/**
 * Liveness (spec 4.2.6-7, 6.3, 8): 3 LATIDO without ECO, RENOVAR only what is permitted, ERROR 8
 * covers RASPADO and INVENTARIO, and the live MIRADA planned again when load recovers or a
 * delivery is cut before its FIN.
 */
public final class LivenessTest {
    public static void main(String[] args) throws Exception {
        testHeartbeatTimeout();
        testRenewalAck();
        testScrapeDeadline();
        testAuditDeadline();
        testReplan();
        System.out.println("LivenessTest OK");
    }

    private static void testHeartbeatTimeout() throws Exception {
        Sessions sessions = new Sessions();
        RecordingMapping mapping = new RecordingMapping();
        Session s = new Session(1, "alice", 256, 0, mapping, new byte[32]);
        s.lastEchoNs = System.nanoTime() - 46_000_000_000L; // 3 x 15 s without ECO
        sessions.add(s);
        new Liveness(new GrantController(null, null, sessions), sessions).tick();
        TestKit.check(mapping.closed, "silent session closed (its Easel retires it)");
    }

    /** Passive revocation: RENOVAR never names what a pending RASPAR takes back. */
    private static void testRenewalAck() throws Exception {
        var s = ConcessionRig.create();
        s.canvas.book().log(new BrushId(0, 0, 0), 0, 2, 100, 1); // 257, stratum 0
        s.grants.narrow(s.canvas, new Concession(2, 1, 2, 768, 36864, 120),
                Reductions.cuts(s.canvas.concession(), 1, 1, 2), null);
        s.mapping.control.clear();
        s.canvas.renewNs = System.nanoTime() - 65_000_000_000L;
        new Liveness(s.grants, s.sessions).tick();
        Frame renew = null;
        for (byte[] f : s.mapping.control) {
            Frame fr = Frame.decode(ByteBuffer.wrap(f));
            if (fr.type() == FrameType.RENOVAR) {
                renew = fr;
            }
        }
        TestKit.check(renew != null, "RENOVAR sent");
        var b = ByteBuffer.wrap(renew.payload());
        seurat.core.shared.proto.VarInt.get(b);
        seurat.core.shared.proto.VarInt.get(b);
        seurat.core.shared.proto.VarInt.get(b);
        Ranges named = Ranges.decode(b);
        TestKit.check(named.contains(1) && !named.contains(257), "stratum 0 (being scraped) not renewed");
        long now = System.nanoTime();
        s.canvas.orders().takeRenewalsThrough(Long.MAX_VALUE).forEach(r ->
                s.canvas.book().acknowledge(r, now, 120_000_000_000L, 1_000_000_000L));
        TestKit.check(s.canvas.book().pruneExpired(now + 60_000_000_000L).isEmpty(), "renewed within lease");
    }

    private static void testReplan() throws Exception {
        var s = ConcessionRig.create();
        s.session.rung = 1; // the plan is cut (spec 6.3)
        s.grants.gaze(s.session, s.canvas, new MsgGaze.Gaze(1, 5, 0, 0, 512, 384, 512, 384, 0));
        TestKit.check((lastStart(s).throttle() & ProtoCodes.REG_CARGA) != 0, "cut plan says CARGA");
        s.mapping.control.clear();
        Liveness liveness = new Liveness(s.grants, s.sessions);
        liveness.tick();
        TestKit.check(lastStart(s) == null, "no recovery, no new plan");
        s.session.rung = 3;
        liveness.tick();
        MsgGaze.Plan again = lastStart(s);
        TestKit.check(again != null && again.gazeSeq() == 5 && (again.throttle() & ProtoCodes.REG_CARGA) == 0,
                "load recovered: the same MIRADA planned again, uncut");
        s.mapping.control.clear();
        liveness.tick();
        TestKit.check(lastStart(s) == null, "planned once per recovery");
        synchronized (s.canvas) {
            s.canvas.plan().lost();
        }
        liveness.tick();
        TestKit.check(lastStart(s) != null, "a delivery cut before its FIN: planned again (spec 8)");
    }

    private static MsgGaze.Plan lastStart(ConcessionRig s) {
        MsgGaze.Plan out = null;
        for (byte[] f : s.mapping.control) {
            Frame fr = Frame.decode(ByteBuffer.wrap(f));
            if (fr.type() == FrameType.PLAN) {
                MsgGaze.Plan p = MsgGaze.Plan.parse(fr.payload());
                out = p.event() == ProtoCodes.PLAN_INICIO ? p : out;
            }
        }
        return out;
    }

    private static void testScrapeDeadline() throws Exception {
        Sessions sessions = new Sessions();
        RecordingMapping mapping = new RecordingMapping();
        Session s = new Session(3, "alice", 256, 0, mapping, new byte[32]);
        Canvas canvas = new Canvas(1, "w", null, new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2),
                new Concession(1, 0, 1, 768, 36864, 120));
        canvas.session(s);
        s.canvases().put(1L, canvas);
        sessions.add(s);
        canvas.orders().addScrape(new seurat.core.viewing.loans.CanvasOrders.ScrapeOrder(canvas.orders().next(), 0, 1,
                d -> true, Ranges.empty(), System.nanoTime() - 1, null, null));
        new Liveness(new GrantController(null, null, sessions), sessions).tick();
        Frame err = Frame.decode(ByteBuffer.wrap(mapping.control.get(0)));
        var pe = MsgError.ProtocolError.parse(err.payload());
        TestKit.check(err.type() == FrameType.ERROR && pe.code() == ProtoCodes.ERR_LIQUIDACION && pe.fail() == 1,
                "no RASPADO in 10 s: ERROR 8 fatal");
        TestKit.check(mapping.closed, "then closed");
        MsgAudit.class.getName();
    }

    private static void testAuditDeadline() throws Exception {
        Sessions sessions = new Sessions();
        RecordingMapping mapping = new RecordingMapping();
        Session s = new Session(3, "alice", 256, 0, mapping, new byte[32]);
        Canvas canvas = new Canvas(1, "w", null, new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2),
                new Concession(1, 0, 1, 768, 36864, 120));
        canvas.session(s);
        s.canvases().put(1L, canvas);
        sessions.add(s);
        canvas.orders().addAudit(new seurat.core.viewing.loans.CanvasOrders.AuditOrder(
                canvas.orders().next(), 0, System.nanoTime() - 1));
        new Liveness(new GrantController(null, null, sessions), sessions).tick();
        Frame err = Frame.decode(ByteBuffer.wrap(mapping.control.get(0)));
        var pe = MsgError.ProtocolError.parse(err.payload());
        TestKit.check(err.type() == FrameType.ERROR && pe.code() == ProtoCodes.ERR_LIQUIDACION && pe.fail() == 1
                && mapping.closed, "no INVENTARIO in 10 s: ERROR 8 fatal");
        TestKit.check(mapping.closed, "then closed");

        Sessions freshSessions = new Sessions();
        RecordingMapping freshMapping = new RecordingMapping();
        Session freshS = new Session(4, "bob", 256, 0, freshMapping, new byte[32]);
        Canvas freshCanvas = new Canvas(2, "w", null, new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2),
                new Concession(1, 0, 1, 768, 36864, 120));
        freshCanvas.session(freshS);
        freshS.canvases().put(2L, freshCanvas);
        freshSessions.add(freshS);
        freshCanvas.orders().addAudit(new seurat.core.viewing.loans.CanvasOrders.AuditOrder(
                freshCanvas.orders().next(), 0, System.nanoTime() + 5_000_000_000L));
        new Liveness(new GrantController(null, null, freshSessions), freshSessions).tick();
        TestKit.check(!freshMapping.closed, "future audit deadline does not close mapping");
    }
}
