package seurat.core.viewing.easel;

import java.nio.file.Files;
import java.util.Arrays;
import seurat.adapters.in.net.socket.RecordingMapping;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.observe.AuditLog;
import seurat.core.shared.observe.Metrics;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.core.viewing.budget.BrushBudget;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.grant.GazeGate;
import seurat.core.viewing.grant.GrantController;
import seurat.core.viewing.paint.Painter;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Regulator;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.store.WorkMeta;
import seurat.kit.TestKit;

/** SOLTAR CRC (spec 5.3, 8): the first one is resent, a second one on the brush alerts the operator. */
public final class CanvasServiceTest {
    private static final WorkMeta META = new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2);

    public static void main(String[] args) throws Exception {
        Sessions sessions = new Sessions();
        Catalog catalog = new Catalog(new DiskArchive(Files.createTempDirectory("cs-works")));
        Painter painter = new Painter(new Regulator(), new BrushBudget(Files.createTempDirectory("cs-cov")), new Metrics());
        GrantController grants = new GrantController(catalog, painter, sessions);
        EaselContext ctx = new EaselContext(sessions, catalog, grants, new GazeGate(grants), 768, 0);
        RecordingMapping mapping = new RecordingMapping();
        Session session = new Session(1, "p", "anonimo", 128, 0, mapping, new byte[32]);
        Canvas canvas = new Canvas(1, "w", null, META, new Concession(1, 0, 4, 1, 768, 36864, 120));
        canvas.session(session);
        session.canvases().put(1L, canvas);
        LoanHandlers service = new LoanHandlers(mapping, ctx);
        BrushId brush = new BrushId(0, 1, 1);

        long first = canvas.book().log(brush, 0, 2, 100, 1).number();
        service.release(session, crc(first));
        TestKit.check(!alerted(brush), "first CRC failure: resent, no alert");
        long again = canvas.book().log(brush, 0, 2, 100, 1).number(); // the resend
        service.release(session, crc(again));
        TestKit.check(alerted(brush), "second CRC failure on the brush: operator alert");
        TestKit.check(!canvas.book().contains(again), "released either way");
        System.out.println("CanvasServiceTest OK");
    }

    private static Frame crc(long n) {
        return new Frame(FrameType.SOLTAR, new MsgLoans.Release(1, ProtoCodes.SOLTAR_CRC, Ranges.of(n)).encode());
    }

    private static boolean alerted(BrushId brush) {
        return Arrays.stream(AuditLog.dump()).anyMatch(l -> l.contains("CRC failed twice on " + brush));
    }
}
