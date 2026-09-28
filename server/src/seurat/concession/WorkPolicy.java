package seurat.concession;

import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConstants;
import seurat.proto.ProtoCodes;
import seurat.session.Canvas;

/** What the catalog lets a canvas hold: the role ceiling and whether the work is LISTA. */
final class WorkPolicy {
    private final Catalog catalog;

    WorkPolicy(Catalog catalog) {
        this.catalog = catalog;
    }

    /** Ceiling of the canvas's role on its work; a withdrawn work grants only the sketch. */
    long[] ceiling(Canvas canvas) {
        WorkRecord work = catalog.get(canvas.workId());
        return work == null ? new long[]{SeuratConstants.SKETCH_MIN, 4} : work.ceiling(canvas.session().role());
    }

    boolean lista(Canvas canvas) {
        WorkRecord work = catalog.get(canvas.workId());
        return work != null && work.meta.state() == ProtoCodes.ST_LISTA;
    }
}
