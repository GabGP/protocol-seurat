package seurat.ingest;

import java.util.Deque;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import seurat.codec.BrushEncoder;
import seurat.codec.Quant;
import seurat.codec.TransformS;
import seurat.store.FileBrushStore;

/** One stratum drain: 256 E(stratum) rows -> brush-row encode + 128 rows upward. */
final class Drain {
    private final int stratum;
    private final int top;
    private final Accumulator[] acc;
    private final FileBrushStore store;
    private final ExecutorService pool;
    private final Deque<Future<?>> tasks;
    private final List<short[][]> seed;
    private final int[] drainCounts;

    Drain(int stratum, int top, Accumulator[] acc, FileBrushStore store,
            ExecutorService pool, Deque<Future<?>> tasks, List<short[][]> seed,
            int[] drainCounts) {
        this.stratum = stratum;
        this.top = top;
        this.acc = acc;
        this.store = store;
        this.pool = pool;
        this.tasks = tasks;
        this.seed = seed;
        this.drainCounts = drainCounts;
    }

    void drain() {
        Accumulator a = acc[stratum];
        int w2 = a.width / 2;
        int[][] ps = new int[3][128 * w2];
        int[][] hd = new int[3][128 * w2];
        int[][] vd = new int[3][128 * w2];
        int[][] dd = new int[3][128 * w2];
        forwardAll(a, ps, vd, hd, dd);
        int nx = (a.width + 255) / 256;
        int by = drainCounts[stratum]++;
        int qy = Quant.qy(stratum);
        int qc = Quant.qc(stratum);
        final int level = stratum;
        final int row = by;
        for (int bx = 0; bx < nx; bx++) {
            final int col = bx;
            tasks.addLast(pool.submit(() -> {
                int[][] pw = Window.parents(ps, w2, col);
                int[][][] hw = Window.details(hd, w2, col);
                int[][][] vw = Window.details(vd, w2, col);
                int[][][] dw = Window.details(dd, w2, col);
                var bb = BrushEncoder.encode(pw, hw, vw, dw, 16384, 128, qy, qc);
                store.append(level, col, row, bb.bands(), bb.crcs());
                return null;
            }));
            throttle(tasks);
        }
        a.clear();
        pushUp(ps, w2);
    }

    private static final int MAX_TASKS = Math.max(64, Runtime.getRuntime().availableProcessors() * 8);

    /** Y/Co/Cg planes are disjoint: same bytes, one task per channel. */
    private void forwardAll(Accumulator a, int[][] ps, int[][] vd, int[][] hd, int[][] dd) {
        Future<?>[] done = new Future<?>[3];
        for (int c = 0; c < 3; c++) {
            final int ch = c;
            done[c] = pool.submit(() -> {
                TransformS.blockForward(a.plane[ch], a.width, 256, ps[ch], vd[ch], hd[ch], dd[ch]);
                return null;
            });
        }
        for (Future<?> f : done) {
            try {
                f.get();
            } catch (Exception ex) {
                throw new RuntimeException(ex);
            }
        }
    }

    private static void throttle(Deque<Future<?>> tasks) {
        while (tasks.size() >= MAX_TASKS) {
            try {
                tasks.pollFirst().get();
            } catch (Exception ex) {
                throw new RuntimeException(ex);
            }
        }
    }

    private void pushUp(int[][] ps, int w2) {
        if (stratum + 1 >= top) {
            for (int y = 0; y < 128; y++) {
                short[][] f = new short[3][w2];
                for (int c = 0; c < 3; c++) {
                    for (int x = 0; x < w2; x++) {
                        f[c][x] = (short) ps[c][y * w2 + x];
                    }
                }
                seed.add(f);
            }
            return;
        }
        Accumulator up = acc[stratum + 1];
        for (int y = 0; y < 128; y++) {
            if (up.full()) {
                new Drain(stratum + 1, top, acc, store, pool, tasks, seed, drainCounts).drain();
            }
            up.addRowDirect(ps[0], ps[1], ps[2], y * w2, w2);
        }
    }
}
