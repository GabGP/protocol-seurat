package seurat.kit;

import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.codec.BrushId;
import seurat.concession.GrantController;
import seurat.net.RecordingMapping;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.Frame;
import seurat.proto.ProtoCodes;
import seurat.regulate.Regulator;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;
import seurat.store.WorkMeta;

/**
 * One work "w" (2x2 stratum-0 brushes, 256 loans logged at stratum 1), one session and one canvas with
 * a grant controller over them, for the concession tests.
 */
public final class ConcessionRig {
    private static final int LOGGED_LOANS = 256;
    private static final int LOAN_ROW = 64;

    public final Sessions sessions = new Sessions();
    public final Catalog catalog;
    public final WorkRecord work;
    public final GrantController grants;
    public final Session session;
    public final Canvas canvas;
    public final RecordingMapping mapping = new RecordingMapping();

    private ConcessionRig(int state) throws Exception {
        var root = Files.createTempDirectory("grants-test");
        catalog = new Catalog(root.resolve("obras"));
        var meta = new WorkMeta("w", "w", 512, 384, 256, 2, state, 2, 0, 2);
        work = new WorkRecord(meta);
        var store = new TestKit.FixedStore(meta);
        for (int bx = 0; bx < 2; bx++) {
            for (int by = 0; by < 2; by++) {
                store.put(new BrushId(0, bx, by), new byte[]{1}, new byte[]{2}, new byte[]{3}, new byte[]{4});
            }
        }
        work.store = store;
        catalog.register(work);
        var painter = new Painter(new Regulator(), new BrushBudget(root.resolve("cov")), new Metrics());
        grants = new GrantController(catalog, painter, sessions);
        session = new Session(1, "p", WorkRecord.AUTHENTICATED, 256, 3, mapping, new byte[32]);
        sessions.add(session);
        canvas = new Canvas(1, "w", store, meta, new Concession(1, 0, 2, 1, 768, 36864, 120));
        canvas.session(session);
        session.canvases().put(1L, canvas);
        for (long n = 1; n <= LOGGED_LOANS; n++) {
            canvas.book().log(new BrushId(1, (int) (n % LOAN_ROW), (int) (n / LOAN_ROW)), 0, 4, 10, 2);
        }
    }

    public static ConcessionRig create(int state) throws Exception {
        return new ConcessionRig(state);
    }

    public static ConcessionRig create() throws Exception {
        return new ConcessionRig(ProtoCodes.ST_LISTA);
    }

    /** Control frames sent to the session, decoded. */
    public List<Frame> frames() {
        var out = new ArrayList<Frame>();
        synchronized (mapping) {
            mapping.control.forEach(f -> out.add(Frame.decode(ByteBuffer.wrap(f))));
        }
        return out;
    }

    public List<Long> controlTypes() {
        return frames().stream().map(Frame::type).toList();
    }

    /** First control frame of this type, or null. */
    public Frame first(long type) {
        return frames().stream().filter(f -> f.type() == type).findFirst().orElse(null);
    }
}
