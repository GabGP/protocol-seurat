package seurat.core.works.ingest;

import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Future;
import seurat.core.shared.codec.BrushEncoder;
import seurat.core.shared.codec.Geometry;
import seurat.core.shared.codec.Quant;
import seurat.core.shared.codec.TransformS;
import seurat.core.shared.config.SeuratConstants;

/** One stratum drain: 256 E(stratum) rows -> brush-row encode + 128 rows upward. */
final class Drain {
    private static final int MAX_TASKS = Math.max(64, Runtime.getRuntime().availableProcessors() * 8);

    private final int stratum;
    private final PassContext ctx;

    Drain(int stratum, PassContext ctx) {
        this.stratum = stratum;
        this.ctx = ctx;
    }

    void drain() {
        Accumulator a = ctx.acc()[stratum];
        int w2 = a.width / 2;
        int[][] ps = new int[3][Geometry.HALF * w2];
        int[][] hd = new int[3][Geometry.HALF * w2];
        int[][] vd = new int[3][Geometry.HALF * w2];
        int[][] dd = new int[3][Geometry.HALF * w2];
        forwardAll(a, ps, vd, hd, dd);
        int nx = Geometry.tiles(a.width);
        int by = ctx.drainCounts()[stratum]++;
        int qy = Quant.qy(stratum);
        int qc = Quant.qc(stratum);
        final int level = stratum;
        final int row = by;
        for (int bx = 0; bx < nx; bx++) {
            final int col = bx;
            ctx.tasks().addLast(ctx.pool().submit(() -> {
                int[][] pw = Window.parents(ps, w2, col);
                int[][][] hw = Window.details(hd, w2, col);
                int[][][] vw = Window.details(vd, w2, col);
                int[][][] dw = Window.details(dd, w2, col);
                var bb = BrushEncoder.encode(pw, hw, vw, dw, Geometry.PARENTS, Geometry.HALF, qy, qc);
                ctx.store().append(level, col, row, bb.bands(), bb.crcs());
                return null;
            }));
            throttle(ctx.tasks());
        }
        a.clear();
        pushUp(ps, w2);
    }

    /** Y/Co/Cg planes and row pairs are disjoint: channels x row slices, on the lane. */
    private void forwardAll(Accumulator a, int[][] ps, int[][] vd, int[][] hd, int[][] dd) {
        int slices = SeuratConstants.INGEST_LANE_SLICES;
        List<Callable<Object>> jobs = new ArrayList<>(3 * slices);
        for (int c = 0; c < 3; c++) {
            for (int s = 0; s < slices; s++) {
                final int ch = c;
                final int y0 = 2 * (s * Geometry.HALF / slices);
                final int y1 = 2 * ((s + 1) * Geometry.HALF / slices);
                jobs.add(() -> {
                    TransformS.blockForward(a.plane[ch], a.width, y0, y1, ps[ch], vd[ch], hd[ch], dd[ch]);
                    return null;
                });
            }
        }
        ctx.onLane(jobs);
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
        if (stratum + 1 >= ctx.top()) {
            for (int y = 0; y < Geometry.HALF; y++) {
                short[][] f = new short[3][w2];
                for (int c = 0; c < 3; c++) {
                    for (int x = 0; x < w2; x++) {
                        f[c][x] = (short) ps[c][y * w2 + x];
                    }
                }
                ctx.seed().add(f);
            }
            return;
        }
        Accumulator up = ctx.acc()[stratum + 1];
        for (int y = 0; y < Geometry.HALF; y++) {
            if (up.full()) {
                new Drain(stratum + 1, ctx).drain();
            }
            up.addRowDirect(ps[0], ps[1], ps[2], y * w2, w2);
        }
    }
}
