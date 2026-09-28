package seurat.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.codec.Quant;
import seurat.observe.AuditLog;
import seurat.observe.Log;
import seurat.observe.LogUnits;
import seurat.proto.ProtoCodes;
import seurat.store.FileBrushStore;
import seurat.store.WorkMeta;

/**
 * Spec 7.1: RECIBIENDO, the ed1 sketch when the master carries an overview (BOCETO), then the one
 * sequential 256-row-band ed2 pass (PINTANDO -> LISTA). Decode runs on a read-ahead thread while
 * the pool encodes brushes. The master is read where MasterHome keeps it and, with
 * keepMaster=false, deleted once the work is LISTA (spec 1.2).
 */
public final class IngestJob implements Runnable {
    private final String id;
    private final String name;
    private final Path master;
    private final Path worksDir;
    private final Catalog catalog;
    private final Runnable onReady;
    private final boolean keepMaster;

    public IngestJob(String id, String name, Path master, Path worksDir,
            Catalog catalog, Runnable onReady) {
        this(id, name, master, worksDir, catalog, onReady, true);
    }

    public IngestJob(String id, String name, Path master, Path worksDir,
            Catalog catalog, Runnable onReady, boolean keepMaster) {
        this.keepMaster = keepMaster;
        this.id = id;
        this.name = name;
        this.master = master;
        this.worksDir = worksDir;
        this.catalog = catalog;
        this.onReady = onReady;
    }

    @Override
    public void run() {
        try {
            if (catalog.isCompleted(id)) {
                Log.info("ingest", "work=" + id + " skipped: already ready");
                return;
            }
            long start = System.currentTimeMillis();
            Log.info("ingest", "work=" + id + " ingest started name=\"" + name + "\" file=" + master.getFileName());
            WorkRecord fresh = new WorkRecord(new WorkMeta(id, name, 0, 0, 256, 0,
                    ProtoCodes.ST_RECIBIENDO, ProtoCodes.ED_NINGUNA, 0, 2));
            fresh.keepMaster = keepMaster;
            catalog.register(fresh);
            try (MasterReader reader = new ReadAheadReader(MasterReaders.open(master))) {
                int w = reader.width();
                int h = reader.height();
                int top = topLevels(w, h);
                Log.info("ingest", "work=" + id + " decoding size=" + w + "x" + h + " strata=" + (top + 1));
                WorkRecord work = catalog.get(id);
                work.meta = new WorkMeta(id, name, w, h, 256, top + 1,
                        ProtoCodes.ST_RECIBIENDO, ProtoCodes.ED_NINGUNA, 0, 2);
                SketchPhase.run(id, master, dir(1), () -> store(top, w, h, 1), top, w, h, catalog);
                catalog.painting(id);
                FileBrushStore ed2 = store(top, w, h, 2);
                new ImagePass(id, catalog, ed2, top, w, h, worksDir).run(reader);
                ed2.close();
                catalog.sketch(id, ed2, ProtoCodes.ST_LISTA, 2);
                catalog.list(id);
                Log.info("ingest", "work=" + id + " ready ed=2 took="
                        + LogUnits.duration(System.currentTimeMillis() - start));
            }
            if (!keepMaster) {
                MasterHome.drop(worksDir, id); // after the reader closed it
            }
            onReady.run();
        } catch (Throwable ex) { // OutOfMemoryError included: never leave a work stuck mid-pass
            AuditLog.alert("work=" + id + " ingest failed: " + LogUnits.cause(ex), ex);
            WorkRecord work = catalog.get(id);
            if (work != null) {
                catalog.sketch(id, work.store, ProtoCodes.ST_FALLIDA, work.meta.edition());
            }
        }
    }

    public static int topLevels(int w, int h) {
        int biggest = Math.max(w, h);
        int level = 0;
        while ((256 << level) < biggest) {
            level++;
        }
        return level;
    }

    public static int padTo(int v, int top) {
        return ((v + (1 << top) - 1) >> top) << top;
    }

    private Path dir(int edition) {
        return edition == 1 ? worksDir.resolve(id).resolve("ed1") : worksDir.resolve(id);
    }

    private FileBrushStore store(int top, int w, int h, int edition) throws Exception {
        Path dir = dir(edition);
        int levels = top + 1;
        int[] nx = new int[levels];
        int[] ny = new int[levels];
        for (int stratum = 0; stratum < levels; stratum++) {
            nx[stratum] = div256(padTo(w, top) >> stratum);
            ny[stratum] = div256(padTo(h, top) >> stratum);
        }
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("quant"), Integer.toString(Quant.TABLE)); // FileBrushStore reads it
        return new FileBrushStore(dir,
                new WorkMeta(id, name, w, h, 256, top + 1, 0, edition, 0, 2), nx, ny);
    }

    public static int div256(int v) {
        return (v + 255) / 256;
    }
}
