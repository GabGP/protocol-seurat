package seurat.ingest;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import seurat.codec.Geometry;
import seurat.codec.YCoCgR;
import seurat.config.SeuratConstants;

/**
 * Master rows into the stratum-0 accumulator (spec 7.1 pass: YCoCg-R, 256-row bands), converted
 * on the lane in row slices straight into its int16 rows; a full accumulator drains.
 */
final class BandFeeder {
    private BandFeeder() {}

    /** Feeds {@code band} as rows {@code row..}; returns the next row. */
    static int feed(PassContext ctx, int[][] band, int row, int width) {
        Accumulator a = ctx.acc()[0];
        int k = 0;
        while (k < band.length) {
            int base = row % Geometry.SIDE;
            int n = Math.min(band.length - k, Geometry.SIDE - base);
            convert(ctx, band, k, n, a, base, width);
            a.rows = Math.max(a.rows, base + n);
            row += n;
            k += n;
            if (a.full()) {
                new Drain(0, ctx).drain();
            }
        }
        return row;
    }

    /** Bottom edge (spec 7.1 "Borde"): the last row repeats until the padded height. */
    static void pad(PassContext ctx, int row, int paddedH) {
        Accumulator a = ctx.acc()[0];
        for (; row < paddedH; row++) {
            a.copyRow((row - 1) % Geometry.SIDE, row % Geometry.SIDE);
            if (a.full()) {
                new Drain(0, ctx).drain();
            }
        }
    }

    private static void convert(PassContext ctx, int[][] band, int k, int n, Accumulator a, int base,
            int width) {
        int slices = Math.min(n, SeuratConstants.INGEST_LANE_SLICES);
        List<Callable<Object>> jobs = new ArrayList<>(slices);
        for (int s = 0; s < slices; s++) {
            int r0 = s * n / slices;
            int r1 = (s + 1) * n / slices;
            jobs.add(() -> {
                for (int r = r0; r < r1; r++) {
                    int y = base + r;
                    YCoCgR.forwardRow(band[k + r], a.plane[0][y], a.plane[1][y], a.plane[2][y], width, a.width);
                }
                return null;
            });
        }
        ctx.onLane(jobs);
    }
}
