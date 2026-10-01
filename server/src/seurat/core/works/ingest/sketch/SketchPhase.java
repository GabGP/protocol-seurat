package seurat.core.works.ingest.sketch;

import java.nio.file.Path;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.ingest.port.MasterSource;
import seurat.core.works.store.FileBrushStore;
import seurat.core.works.store.SeedFile;

/**
 * Spec 7.1 steps 2-3, before the pass: when the master carries an overview (or an interrupted
 * pass left its edition 1, spec 7.2), the ed1 sketch and OBRA(ESTADO, BOCETO). Without one there
 * is no sketch: the work stays unopenable until LISTA, and the master is read once, by the pass.
 */
public final class SketchPhase {
    private SketchPhase() {}

    /** The ed1 store to write into, created only when there is a sketch to write. */
    public interface Ed1 {
        FileBrushStore open() throws Exception;
    }

    public static void run(String id, Path master, MasterSource source, Path ed1Dir, Ed1 ed1, int top, int w, int h,
            Catalog catalog) {
        try {
            boolean kept = SeedFile.present(ed1Dir);
            MasterSource.Sampled overview = kept ? null : source.overview(master, w, h, SketchBuilder.sampling(top));
            if (!kept && overview == null) {
                Log.info(LogTags.INGEST, LogTags.work(id) + " sketch skipped: no overview");
                return;
            }
            FileBrushStore store = ed1.open();
            if (!kept) {
                SketchBuilder.build(overview, store, top);
            }
            store.close();
            catalog.sketch(id, store, ProtoCodes.ST_BOCETO, 1);
            Log.info(LogTags.INGEST, LogTags.work(id) + " sketch ready ed=1 source=" + (kept ? "kept" : "overview"));
        } catch (Exception ex) {
            Log.warn(LogTags.INGEST, LogTags.work(id) + " sketch skipped: " + LogUnits.cause(ex));
        }
    }
}
