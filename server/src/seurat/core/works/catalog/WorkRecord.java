package seurat.core.works.catalog;

import seurat.core.works.store.BrushStore;
import seurat.core.works.store.WorkMeta;

/** One work: meta + live store handle. */
public final class WorkRecord {
    public volatile WorkMeta meta;
    public volatile BrushStore store;
    /** Spec 1.2, 7.2 (meta.json): false deletes obras/<id>/master/ when the ingest ends. */
    public volatile boolean keepMaster = true;

    public WorkRecord(WorkMeta meta) {
        this.meta = meta;
    }
}
