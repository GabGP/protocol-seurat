package seurat.core.viewing.grant;

import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.viewing.session.Canvas;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.catalog.WorkRecord;

/** What the catalog lets a canvas hold: the work ceiling and whether the work is LISTA. */
final class WorkPolicy {
    private final Catalog catalog;

    WorkPolicy(Catalog catalog) {
        this.catalog = catalog;
    }

    /** Ceiling of the canvas on its work; a withdrawn work grants only the sketch. */
    long[] ceiling(Canvas canvas) {
        WorkRecord work = catalog.get(canvas.workId());
        return work == null ? new long[]{SeuratConstants.SKETCH_MIN, 4} : work.ceiling();
    }

    boolean lista(Canvas canvas) {
        WorkRecord work = catalog.get(canvas.workId());
        return work != null && work.meta.state() == ProtoCodes.ST_LISTA;
    }
}
