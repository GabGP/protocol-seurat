package seurat.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.observe.Log;
import seurat.proto.ProtoCodes;
import seurat.store.FileBrushStore;
import seurat.store.WorkMeta;

/**
 * Spec 7.1 step 3 on its own thread: the ed1 sketch from its own read of the master, then
 * BOCETO and PINTANDO. It runs beside the pass instead of before it, so a master without an
 * overview (PNG, JPEG) is not read twice in a row; the pass joins it before LISTA or FALLIDA,
 * so the states still go RECIBIENDO, BOCETO, PINTANDO, LISTA.
 */
final class SketchPhase {
    private final Thread thread;
    private final java.util.concurrent.CompletableFuture<Void> done = new java.util.concurrent.CompletableFuture<>();

    SketchPhase(String id, Path master, FileBrushStore ed1, int top, Catalog catalog, WorkMeta painting) {
        // One reader against a pass that fills every core: high priority where the OS honors it,
        // and the pass keeps a core free for it until done() (see ImagePass).
        this.thread = Thread.ofPlatform().name("ingest-sketch-" + id).priority(Thread.MAX_PRIORITY)
                .start(() -> {
                    try {
                        run(id, master, ed1, top, catalog, painting);
                    } finally {
                        done.complete(null);
                    }
                });
    }

    /** Completes when BOCETO (or its absence) and PINTANDO are settled. */
    java.util.concurrent.CompletionStage<Void> done() {
        return done;
    }

    void join() throws InterruptedException {
        thread.join();
    }

    private static void run(String id, Path master, FileBrushStore ed1, int top, Catalog catalog,
            WorkMeta painting) {
        try {
            Path seed = ed1.dir().resolve("semilla.bin");
            if (!Files.isRegularFile(seed) || Files.size(seed) <= 4) {
                try {
                    SketchBuilder.build(master, ed1, top);
                } catch (Exception | OutOfMemoryError sketchEx) {
                    Log.warn("ingest", "Work '" + id + "' ed1 sketch unavailable ("
                            + sketchEx.getMessage() + "), continuing full pass");
                }
            }
            ed1.close();
            if (Files.isRegularFile(seed) && Files.size(seed) > 4) {
                catalog.sketch(id, ed1, ProtoCodes.ST_BOCETO, 1);
                Log.info("ingest", "Work '" + id + "' ed1 sketch generated (ST_BOCETO)");
            } else {
                Log.info("ingest", "Work '" + id + "' continuing without ed1 sketch");
            }
        } catch (Exception ex) {
            Log.warn("ingest", "Work '" + id + "' ed1 sketch failed: " + ex.getMessage());
        } finally {
            WorkRecord work = catalog.get(id);
            if (work != null) {
                work.meta = painting;
            }
        }
    }
}
