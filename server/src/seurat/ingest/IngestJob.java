package seurat.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.codec.Geometry;
import seurat.codec.Quant;
import seurat.observe.AuditLog;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.observe.Progress;
import seurat.proto.ProtoCodes;
import seurat.store.FileBrushStore;
import seurat.store.StoreFiles;
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
                Log.info(LogTags.INGEST, LogTags.work(id) + " skipped: already ready");
                return;
            }
            long start = System.currentTimeMillis();
            Log.info(LogTags.INGEST, LogTags.work(id) + " ingest started name=\"" + name + "\" file=" + master.getFileName());
            WorkRecord fresh = new WorkRecord(WorkMeta.of(id, name, 0, 0, Geometry.SIDE, 0,
                    ProtoCodes.ST_RECIBIENDO, ProtoCodes.ED_NINGUNA));
            fresh.keepMaster = keepMaster;
            catalog.register(fresh);
            try (MasterReader reader = new ReadAheadReader(MasterReaders.open(master))) {
                int w = reader.width();
                int h = reader.height();
                int top = topLevels(w, h);
                Log.info(LogTags.INGEST, LogTags.work(id) + " decoding size=" + w + "x" + h + " strata=" + (top + 1));
                WorkRecord work = catalog.get(id);
                work.meta = WorkMeta.of(id, name, w, h, Geometry.SIDE, top + 1,
                        ProtoCodes.ST_RECIBIENDO, ProtoCodes.ED_NINGUNA);
                Progress.phase(LogTags.INGEST, LogTags.work(id), "sketching", "");
                SketchPhase.run(id, master, dir(1), () -> store(top, w, h, 1), top, w, h, catalog);
                catalog.painting(id);
                FileBrushStore ed2 = store(top, w, h, 2);
                new ImagePass(id, catalog, ed2, top, w, h, worksDir).run(reader);
                ed2.close();
                catalog.sketch(id, ed2, ProtoCodes.ST_LISTA, 2);
                catalog.list(id);
                Log.info(LogTags.INGEST, LogTags.work(id) + " ready ed=2 took="
                        + LogUnits.duration(System.currentTimeMillis() - start));
            }
            if (!keepMaster) {
                MasterHome.drop(worksDir, id); // after the reader closed it
            }
            onReady.run();
        } catch (Throwable ex) { // OutOfMemoryError included: never leave a work stuck mid-pass
            AuditLog.alert(LogTags.work(id) + " ingest failed: " + LogUnits.cause(ex), ex);
            WorkRecord work = catalog.get(id);
            if (work != null) {
                catalog.sketch(id, work.store, ProtoCodes.ST_FALLIDA, work.meta.edition());
            }
        } finally {
            Progress.done(LogTags.work(id));
        }
    }

    public static int topLevels(int w, int h) {
        int biggest = Math.max(w, h);
        int level = 0;
        while ((Geometry.SIDE << level) < biggest) {
            level++;
        }
        return level;
    }

    private Path dir(int edition) {
        return edition == 1 ? worksDir.resolve(id).resolve(StoreFiles.SKETCH_DIR) : worksDir.resolve(id);
    }

    private FileBrushStore store(int top, int w, int h, int edition) throws Exception {
        Path dir = dir(edition);
        int levels = top + 1;
        int[] nx = new int[levels];
        int[] ny = new int[levels];
        for (int stratum = 0; stratum < levels; stratum++) {
            nx[stratum] = Geometry.tiles(Geometry.padTo(w, top) >> stratum);
            ny[stratum] = Geometry.tiles(Geometry.padTo(h, top) >> stratum);
        }
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(StoreFiles.QUANT), Integer.toString(Quant.TABLE)); // FileBrushStore reads it
        return new FileBrushStore(dir,
                WorkMeta.of(id, name, w, h, Geometry.SIDE, top + 1, 0, edition), nx, ny);
    }
}
