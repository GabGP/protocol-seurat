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
import seurat.store.FileBrushStore;

/** The single full-resolution pass: bands in, brushes + seed out. */
final class ImagePass {
    private final String id;
    private final Catalog catalog;
    private final FileBrushStore store;
    private final int top;
    private final int width;
    private final int height;
    private final java.nio.file.Path worksDir;

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
        // close() waits for queued brushes: a failed pass leaves no threads or writers behind.
        try (ExecutorService pool = Executors.newFixedThreadPool(
                Math.max(1, Runtime.getRuntime().availableProcessors() - 1))) {
            java.util.ArrayDeque<Future<?>> tasks = new java.util.ArrayDeque<>();
            int[] drainCounts = new int[top];
            int[][] yuv = new int[3][paddedW];
            int row = 0;
            int[][] band;
            while ((band = reader.next()) != null) {
                for (int[] rgbRow : band) {
                    YCoCgR.forwardRow(rgbRow, 0, yuv[0], yuv[1], yuv[2], 0, width);
                    for (int c = 0; c < 3; c++) {
                        for (int x = width; x < paddedW; x++) {
                            yuv[c][x] = yuv[c][width - 1];
                        }
                    }
                    row = feed(acc, yuv, paddedW, row, pool, tasks, seed, drainCounts);
                }
                catalog.progress(id, (int) (reader.fraction() * 100));
            }
            while (row < paddedH) {
                acc[0].addRow(row % 256, yuv[0], yuv[1], yuv[2], paddedW);
                row++;
                if (acc[0].full()) {
                    new Drain(0, top, acc, store, pool, tasks, seed, drainCounts).drain();
                }
            }
            for (int stratum = 0; stratum < top; stratum++) {
                acc[stratum].replicate();
                if (acc[stratum].rows > 0) {
                    new Drain(stratum, top, acc, store, pool, tasks, seed, drainCounts).drain();
                }
            }
            for (Future<?> task : tasks) {
                task.get();
            }
        }
        writeSeed(seed, paddedW >> top, paddedH >> top);
    }

    private void runTopZero(MasterReader reader) throws Exception {
        List<short[][]> seed = new ArrayList<>();
        int[][] yuv = new int[3][width];
        int[][] band;
        while ((band = reader.next()) != null) {
            for (int[] rgbRow : band) {
                YCoCgR.forwardRow(rgbRow, 0, yuv[0], yuv[1], yuv[2], 0, width);
                short[][] r = new short[3][width];
                for (int c = 0; c < 3; c++) {
                    for (int x = 0; x < width; x++) r[c][x] = (short) yuv[c][x];
                }
                seed.add(r);
            }
            catalog.progress(id, (int) (reader.fraction() * 100));
        }
        writeSeed(seed, width, height);
    }

    private int feed(Accumulator[] acc, int[][] yuv, int paddedW, int row,
            ExecutorService pool, java.util.Deque<Future<?>> tasks, List<short[][]> seed,
            int[] drainCounts) {
        acc[0].addRow(row % 256, yuv[0], yuv[1], yuv[2], paddedW);
        if (acc[0].full()) {
            new Drain(0, top, acc, store, pool, tasks, seed, drainCounts).drain();
        }
        return row + 1;
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
        Files.write(worksDir.resolve(id).resolve("semilla.bin"),
                SeedCodec.encode(planes, seedW, seedH));
    }
}
