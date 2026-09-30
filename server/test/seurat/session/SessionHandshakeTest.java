package seurat.session;

import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.codec.BrushId;
import seurat.concession.Concession;
import seurat.grant.GazeGate;
import seurat.grant.GrantController;
import seurat.kit.TestKit;
import seurat.net.RecordingMapping;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgError;
import seurat.proto.MsgGaze;
import seurat.proto.MsgHello;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.store.WorkMeta;

/** SALUDO (spec 3.4.1) and REANUDAR (spec 3.4.4, 8): token, caps, claims, idempotency. */
public final class SessionHandshakeTest {
    private static final WorkMeta META = new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2);

    public static void main(String[] args) throws Exception {
        testNormalHello();
        testResumeSuccess();
        testResumeRejection();
        testResumeWhileOldSocketHalfOpen();
        testResumeAdoptsOnlyClaims();
        testRetiredWorkNotResumed();
        testSilentPeerTimesOut();
        System.out.println("SessionHandshakeTest OK");
    }

    private static EaselContext ctx(Sessions sessions, boolean withWork) throws Exception {
        Catalog catalog = new Catalog(Files.createTempDirectory("hs-works"));
        if (withWork) {
            catalog.register(new WorkRecord(META));
        }
        Painter painter = new Painter(new Regulator(), new BrushBudget(Files.createTempDirectory("hs-cov")), new Metrics());
        GrantController grants = new GrantController(catalog, painter, sessions);
        return new EaselContext(sessions, catalog, grants, new GazeGate(grants), 768, 0);
    }

    /** A dead session holding canvas 1 with delivery 1; returns its ticket. */
    private static byte[] grave(Sessions sessions, long id) {
        byte[] ticket = sessions.newTicket();
        Session old = new Session(id, "alice", "autenticado", 256, ProtoCodes.CAP_REANUDAR, new RecordingMapping(), ticket);
        Canvas canvas = new Canvas(1, "w", null, META, new Concession(1, 0, 4, 1, 768, 36864, 120));
        canvas.book().log(new BrushId(1, 0, 0), 0, 2, 100, 1);
        canvas.session(old);
        old.canvases().put(1L, canvas);
        sessions.add(old);
        sessions.retire(old);
        return ticket;
    }

    private static Session hello(EaselContext ctx, RecordingMapping mapping, MsgHello.ResumeRequest resume)
            throws Exception {
        byte[] token = HexFormat.of().parseHex(ctx.sessions().issueToken("alice", "autenticado", 256, 60000));
        var queue = new LinkedBlockingQueue<byte[]>();
        queue.add(new Frame(FrameType.SALUDO, new MsgHello.Hello(1, 1,
                ProtoCodes.CAP_REANUDAR | ProtoCodes.CAP_DATAGRAMAS, 256, token, resume).encode()).encode());
        return new SessionHandshake(mapping, queue, ctx).hello();
    }

    private static long type(RecordingMapping m, int i) {
        return Frame.decode(ByteBuffer.wrap(m.control.get(i))).type();
    }

    /** A reloaded page resumes with no claims: nothing is adopted, so no later audit can fail. */
    private static void testResumeAdoptsOnlyClaims() throws Exception {
        Sessions sessions = new Sessions();
        EaselContext ctx = ctx(sessions, true);
        byte[] ticket = grave(sessions, 300);
        RecordingMapping mapping = new RecordingMapping();
        Session s = hello(ctx, mapping, new MsgHello.ResumeRequest(300, ticket, List.of()));
        TestKit.check(s.canvases().isEmpty(), "unclaimed canvas not adopted");
        TestKit.check(mapping.control.size() == 1, "BIENVENIDA only, no CONCESION");
    }

    private static void testNormalHello() throws Exception {
        Sessions sessions = new Sessions();
        RecordingMapping mapping = new RecordingMapping();
        Session s = hello(ctx(sessions, true), mapping, null);
        TestKit.check(s != null && s.principal().equals("alice"), "session created");
        TestKit.check(mapping.control.size() == 1 && type(mapping, 0) == FrameType.BIENVENIDA, "sent BIENVENIDA");
        TestKit.check(s.caps() == ProtoCodes.CAP_REANUDAR, "WS answers DATAGRAMAS = 0 (spec 3.5)");
    }

    private static void testResumeSuccess() throws Exception {
        Sessions sessions = new Sessions();
        EaselContext ctx = ctx(sessions, true);
        byte[] ticket = grave(sessions, 100);
        var resume = new MsgHello.ResumeRequest(100, ticket, List.of(new MsgHello.Claim(1, Ranges.of(1))));
        RecordingMapping lost = new RecordingMapping();
        Session first = hello(ctx, lost, resume);
        sessions.retire(first); // BIENVENIDA lost: the retry must give the same result
        RecordingMapping mapping = new RecordingMapping();
        Session s = hello(ctx, mapping, resume);
        TestKit.check(s.canvases().get(1L).book().contains(1), "retry adopts the same book (idempotent)");
        TestKit.check(mapping.control.size() == 2, "sent BIENVENIDA + CONCESION");
        TestKit.check(type(mapping, 0) == FrameType.BIENVENIDA, "frame 0 is BIENVENIDA");
        Frame f1 = Frame.decode(ByteBuffer.wrap(mapping.control.get(1)));
        TestKit.check(f1.type() == FrameType.CONCESION && MsgGaze.ConcessionMessage.parse(f1.payload()).handle() == 1,
                "CONCESION for handle 1");
    }

    private static void testResumeRejection() throws Exception {
        Sessions sessions = new Sessions();
        EaselContext ctx = ctx(sessions, true);
        byte[] ticket = grave(sessions, 200);
        RecordingMapping mapping = new RecordingMapping();
        hello(ctx, mapping, new MsgHello.ResumeRequest(200, ticket,
                List.of(new MsgHello.Claim(1, Ranges.of(999)))));
        TestKit.check(mapping.control.size() == 2, "sent ERROR 12 then BIENVENIDA");
        Frame f0 = Frame.decode(ByteBuffer.wrap(mapping.control.get(0)));
        TestKit.check(f0.type() == FrameType.ERROR
                && MsgError.ProtocolError.parse(f0.payload()).code() == ProtoCodes.ERR_REANUDACION
                && MsgError.ProtocolError.parse(f0.payload()).fail() == 0, "ERROR 12, not fatal");
    }

    /** The old socket is half-open (the server still lists the session live): REANUDAR gets BIENVENIDA, not ERROR 12. */
    private static void testResumeWhileOldSocketHalfOpen() throws Exception {
        Sessions sessions = new Sessions();
        EaselContext ctx = ctx(sessions, true);
        byte[] ticket = grave(sessions, 500);
        Session old = new Session(501, "alice", "autenticado", 256, ProtoCodes.CAP_REANUDAR, new RecordingMapping(), ticket);
        Canvas canvas = new Canvas(1, "w", null, META, new Concession(1, 0, 4, 1, 768, 36864, 120));
        canvas.book().log(new BrushId(1, 0, 0), 0, 2, 100, 1);
        canvas.session(old);
        old.canvases().put(1L, canvas);
        sessions.add(old); // never retired: nothing told the server the link died
        var resume = new MsgHello.ResumeRequest(501, ticket, List.of(new MsgHello.Claim(1, Ranges.of(1))));
        RecordingMapping mapping = new RecordingMapping();
        Session s = hello(ctx, mapping, resume);
        TestKit.check(type(mapping, 0) == FrameType.BIENVENIDA, "BIENVENIDA, not ERROR 12");
        TestKit.check(s.canvases().get(1L).book().contains(1), "the live session's book is adopted");
        sessions.retire(old);
        TestKit.check(sessions.resumable(501, ticket, "alice").holder() == s, "the late retire keeps the adopter");
    }

    /** Spec 7.4: a REANUDAR on a withdrawn work is rejected. */
    private static void testRetiredWorkNotResumed() throws Exception {
        Sessions sessions = new Sessions();
        EaselContext ctx = ctx(sessions, false);
        byte[] ticket = grave(sessions, 400);
        RecordingMapping mapping = new RecordingMapping();
        Session s = hello(ctx, mapping, new MsgHello.ResumeRequest(400, ticket,
                List.of(new MsgHello.Claim(1, Ranges.of(1)))));
        TestKit.check(s.canvases().isEmpty() && type(mapping, 0) == FrameType.ERROR, "withdrawn work: ERROR 12");
    }

    /** A socket that opens and never sends SALUDO does not hold its Easel forever. */
    private static void testSilentPeerTimesOut() throws Exception {
        boolean closed = false;
        try {
            new SessionHandshake(new RecordingMapping(), new LinkedBlockingQueue<byte[]>(),
                    ctx(new Sessions(), false), 50).hello();
        } catch (java.io.EOFException expected) {
            closed = true;
        }
        TestKit.check(closed, "no SALUDO in time ends the handshake");
    }
}
