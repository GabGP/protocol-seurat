package seurat.session;

import java.util.HashSet;
import java.util.Set;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.proto.MsgGaze;
import seurat.store.BrushStore;
import seurat.store.WorkMeta;

/** Open work: handle, concession, authoritative book, orders and live plan. Lock: the canvas. */
public final class Canvas {
    private final long handle;
    private final String workId;
    private BrushStore store;
    private WorkMeta meta;
    private Concession concession;
    private final LoanBook book = new LoanBook();
    private final CanvasOrders orders = new CanvasOrders();
    private final PlanProgress plan = new PlanProgress();
    private final Set<BrushId> retried = new HashSet<>();
    private final Set<BrushId> unusable = new HashSet<>();
    private Session session;
    private MsgGaze.Gaze gaze;

    public long renewNs;
    public long auditNs;
    public long auditBase;
    /** Receiver window from this handle's last RECIBO.libre: max unconfirmed deliveries. */
    public volatile long free = SeuratConstants.INITIAL_CREDIT;
    /** Withdrawal under way (spec 7.4): no new plans, only the final scrape. */
    public volatile boolean retiring;
    /** Inactivity floor (spec 2.3): no MIRADA yet, OCULTA, 60 s idle, or the work not LISTA. */
    public volatile boolean floored = true;

    public Canvas(long handle, String workId, BrushStore store, WorkMeta meta, Concession concession) {
        this.handle = handle;
        this.workId = workId;
        this.store = store;
        this.meta = meta;
        this.concession = concession;
        book.edition(meta.edition());
    }

    public long handle() {
        return handle;
    }

    public String workId() {
        return workId;
    }

    public BrushStore store() {
        return store;
    }

    public WorkMeta meta() {
        return meta;
    }

    /** Edition swap: bands are owed again in the new edition. */
    public void setStore(BrushStore value, WorkMeta nextMeta) {
        store = value;
        meta = nextMeta;
        book.edition(nextMeta.edition());
    }

    public Session session() {
        return session;
    }

    public void session(Session value) {
        session = value;
    }

    /** Log subject: s7/c3. */
    public String subject() {
        return "s" + (session == null ? "?" : session.id()) + "/c" + handle;
    }

    public LoanBook book() {
        return book;
    }

    public CanvasOrders orders() {
        return orders;
    }

    public PlanProgress plan() {
        return plan;
    }

    public Concession concession() {
        return concession;
    }

    public void setConcession(Concession c) {
        concession = c;
    }

    public MsgGaze.Gaze gaze() {
        return gaze;
    }

    public void setGaze(MsgGaze.Gaze value) {
        gaze = value;
    }

    /** Planner view: a brush unusable this session (spec 5.3) counts as held, so it is never planned again. */
    public int plannedBands(BrushId p) {
        return unusable.contains(p) ? 4 : book.bands(p);
    }

    /** SOLTAR DECODIFICACION / CRC: true the first time (resend once), then the brush is given up. */
    public boolean retryOnce(BrushId p) {
        if (retried.add(p)) {
            return true;
        }
        unusable.add(p);
        return false;
    }
}
