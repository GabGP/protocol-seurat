package seurat.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.Catalog;
import seurat.observe.Log;
import seurat.proto.ProtoCodes;
import seurat.store.FileBrushStore;

/**
 * Spec 7.1 steps 2-3, before the pass: when the master carries an overview (or an interrupted
 * pass left its edition 1, spec 7.2), the ed1 sketch and OBRA(ESTADO, BOCETO). Without one there
 * is no sketch: the work stays unopenable until LISTA, and the master is read once, by the pass.
 */
final class SketchPhase {
    private SketchPhase() {}

    /** The ed1 store to write into, created only when there is a sketch to write. */
    interface Ed1 {
        FileBrushStore open() throws Exception;
    }

    static void run(String id, Path master, Path ed1Dir, Ed1 ed1, int top, int w, int h, Catalog catalog) {
        try {
            Path seed = ed1Dir.resolve("semilla.bin");
            boolean kept = Files.isRegularFile(seed) && Files.size(seed) > 4;
            Overview.Sampled overview = kept ? null : Overview.probe(master, w, h, SketchBuilder.sampling(top));
            if (!kept && overview == null) {
                Log.info("ingest", "Work '" + id + "' carries no overview: no sketch, straight to the pass");
                return;
            }
            FileBrushStore store = ed1.open();
            if (!kept) {
                SketchBuilder.build(overview, store, top);
            }
            store.close();
            catalog.sketch(id, store, ProtoCodes.ST_BOCETO, 1);
            Log.info("ingest", "Work '" + id + "' ed1 sketch " + (kept ? "kept" : "from its overview") + " (ST_BOCETO)");
        } catch (Exception ex) {
            Log.warn("ingest", "Work '" + id + "' sketch unavailable (" + ex.getMessage() + "), continuing with the pass");
        }
    }
}
