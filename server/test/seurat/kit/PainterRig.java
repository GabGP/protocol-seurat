package seurat.kit;

import java.nio.ByteBuffer;
import java.nio.file.Files;
import seurat.budget.BrushBudget;
import seurat.codec.BrushId;
import seurat.net.RecordingMapping;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgGaze;
import seurat.regulate.Regulator;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;
import seurat.store.WorkMeta;

/** One painter over one session and one canvas of a 2-band, 2-brush work, for the paint tests. */
public final class PainterRig {
    private static final long WAIT_MS = 5000;
    private static final long POLL_MS = 20;

    public final Painter painter;
    public final Canvas canvas;
    public final Session session;
    public final RecordingMapping mapping = new RecordingMapping();
    public final TestKit.FixedStore store;
    public final Regulator regulator = new Regulator();

    private PainterRig() throws Exception {
        var root = Files.createTempDirectory("painter-test");
        var meta = new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2);
        store = new TestKit.FixedStore(meta);
        store.put(new BrushId(1, 0, 0), new byte[]{10}, new byte[]{11}, new byte[]{12}, new byte[]{13});
        store.put(new BrushId(1, 1, 0), new byte[]{20}, new byte[]{21}, new byte[]{22}, new byte[]{23});
        painter = new Painter(regulator, new BrushBudget(root.resolve("cov")), new Metrics());
        var sessions = new Sessions();
        session = new Session(1, "p", "autenticado", 256, 3, mapping, new byte[32]);
        sessions.add(session);
        canvas = new Canvas(1, "w", store, meta, new Concession(1, 0, 4, 1, 768, 36864, 120));
        canvas.session(session);
        session.canvases().put(1L, canvas);
    }

    public static PainterRig create() throws Exception {
        return new PainterRig();
    }

    /** Runs the painter loop on a daemon thread; the caller interrupts it when done. */
    public Thread start() {
        return Thread.ofPlatform().daemon().start(painter);
    }

    /** Waits (up to 5 s) until at least n deliveries reached the mapping. */
    public void awaitDeliveries(int n) throws InterruptedException {
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (mapping.deliveries.size() < n && System.currentTimeMillis() < deadline) {
            Thread.sleep(POLL_MS);
        }
    }

    /** Control frames of PLAN with the given event (0 start, 1 FIN). */
    public int planEvents(int event) {
        int n = 0;
        synchronized (mapping) {
            for (byte[] frame : mapping.control) {
                Frame f = Frame.decode(ByteBuffer.wrap(frame));
                if (f.type() == FrameType.PLAN && MsgGaze.Plan.parse(f.payload()).event() == event) {
                    n++;
                }
            }
        }
        return n;
    }
}
