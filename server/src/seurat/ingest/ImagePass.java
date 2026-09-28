package seurat.ingest;

import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import seurat.catalog.Catalog;
import seurat.codec.SeedCodec;
import seurat.codec.YCoCgR;
import seurat.config.Units;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.observe.Progress;
import seurat.store.FileBrushStore;
import seurat.store.StoreFiles;

/** The single full-resolution pass: bands in, brushes + seed out. */
final class ImagePass {
    private final String id;
    private final Catalog catalog;
    private final FileBrushStore store;
    private final int top;
    private final int width;
    private final int height;
    private final java.nio.file.Path worksDir;
    private final long start = System.currentTimeMillis();

    ImagePass(String id, Catalog catalog, FileBrushStore store, int top, int width,
            int height, java.nio.file.Path worksDir) {
        this.id = id;
        this.catalog = catalog;
        this.store = store;
        this.top = top;
        this.width = width;
        this.height = height;
        this.worksDir = worksDir;
    }

    void run(MasterReader reader) throws Exception {
        if (top == 0) {
            runTopZero(reader);
            return;
        }
        int paddedW = IngestJob.padTo(width, top);
        int paddedH = IngestJob.padTo(height, top);
        Accumulator[] acc = new Accumulator[top];
        for (int stratum = 0; stratum < top; stratum++) {
            acc[stratum] = new Accumulator(paddedW >> stratum);
        }
        List<short[][]> seed = new ArrayList<>();
        int cores = Runtime.getRuntime().availableProcessors();
        // close() waits for queued brushes: a failed pass leaves no threads or writers behind.
        try (ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, cores - 1));
                ExecutorService lane = Executors.newFixedThreadPool(cores)) {
            PassContext ctx = new PassContext(top, acc, store, pool, lane,
                    new java.util.ArrayDeque<>(), seed, new int[top]);
            int row = 0;
            int[][] band;
            while ((band = reader.next()) != null) {
                row = BandFeeder.feed(ctx, band, row, width);
                progress(reader);
            }
            finishing();
            BandFeeder.pad(ctx, row, paddedH);
            for (int stratum = 0; stratum < top; stratum++) {
                acc[stratum].replicate();
                if (acc[stratum].rows > 0) {
                    new Drain(stratum, ctx).drain();
                }
            }
            for (Future<?> task : ctx.tasks()) {
                task.get();
            }
        }
        writeSeed(seed, paddedW >> top, paddedH >> top);
    }

    private void runTopZero(MasterReader reader) throws Exception {
        List<short[][]> seed = new ArrayList<>();
        int[][] band;
        while ((band = reader.next()) != null) {
            for (int[] rgbRow : band) {
                short[][] r = new short[3][width];
                YCoCgR.forwardRow(rgbRow, r[0], r[1], r[2], width, width);
                seed.add(r);
            }
            progress(reader);
        }
        finishing();
        writeSeed(seed, width, height);
    }

    /** PINTANDO's progress (spec 7.1 step 4): OBRA(ESTADO) on every whole percent, and the console bar. */
    private void progress(MasterReader reader) {
        double fraction = reader.fraction();
        catalog.progress(id, (int) (fraction * Units.PERCENT));
        Progress.update(LogTags.INGEST, LogTags.work(id), "painting", (int) (fraction * Units.PERCENT), " rate="
                + LogUnits.pixelRate((long) (fraction * height) * width, System.currentTimeMillis() - start));
    }

    /** Every band is read: what is left is draining the strata, waiting on the brushes and the seed. */
    private void finishing() {
        Progress.phase(LogTags.INGEST, LogTags.work(id), "finishing", "");
    }

    private void writeSeed(List<short[][]> seed, int seedW, int seedH) throws Exception {
        int[][] planes = new int[3][seedW * seedH];
        for (int y = 0; y < seedH; y++) {
            short[][] seedRow = seed.get(Math.min(y, seed.size() - 1));
            for (int c = 0; c < 3; c++) {
                for (int x = 0; x < seedW; x++) {
                    planes[c][y * seedW + x] = seedRow[c][Math.min(x, seedRow[c].length - 1)];
                }
            }
        }
        Files.write(worksDir.resolve(id).resolve(StoreFiles.SEED),
                SeedCodec.encode(planes, seedW, seedH));
    }
}
