package seurat.core.shared.codec;

/** Integer Haar lifting (S) per 2x2 [a b; c d]. Exact round-trip. */
public final class TransformS {
    private TransformS() {}

    /** Forward: returns {S, V, H, D}. */
    public static int[] forward(int a, int b, int c, int d) {
        int l1 = (a + b) >> 1;
        int h1 = a - b;
        int l2 = (c + d) >> 1;
        int h2 = c - d;
        return new int[]{(l1 + l2) >> 1, l1 - l2, (h1 + h2) >> 1, h1 - h2};
    }

    /** Inverse of {S, V, H, D} back to {a, b, c, d}. */
    public static int[] inverse(int stratum, int v, int h, int dd) {
        int l1 = stratum + ((v + 1) >> 1);
        int l2 = l1 - v;
        int h1 = h + ((dd + 1) >> 1);
        int h2 = h1 - dd;
        int a = l1 + ((h1 + 1) >> 1);
        return new int[]{a, a - h1, l2 + ((h2 + 1) >> 1), l2 + ((h2 + 1) >> 1) - h2};
    }

    /** Block forward on even-sized plane: S/H/V/D quarter-planes out. */
    public static void blockForward(int[] src, int w, int h,
            int[] ps, int[] pv, int[] ph, int[] pd) {
        int hw = w / 2;
        for (int y = 0; y < h; y += 2) {
            int y0 = y * w, y1 = (y + 1) * w, rowOut = (y / 2) * hw;
            for (int x = 0; x < w; x += 2) {
                int a = src[y0 + x], b = src[y0 + x + 1];
                int c = src[y1 + x], d = src[y1 + x + 1];
                int l1 = (a + b) >> 1, h1 = a - b;
                int l2 = (c + d) >> 1, h2 = c - d;
                int o = rowOut + (x / 2);
                ps[o] = (l1 + l2) >> 1;
                pv[o] = l1 - l2;
                ph[o] = (h1 + h2) >> 1;
                pd[o] = h1 - h2;
            }
        }
    }

    /**
     * Block forward on 2D scanline short planes, rows [y0, y1) only (both even): output rows are
     * disjoint, so slices can run in parallel.
     */
    public static void blockForward(short[][] src, int w, int y0, int y1,
            int[] ps, int[] pv, int[] ph, int[] pd) {
        int hw = w / 2;
        for (int y = y0; y < y1; y += 2) {
            short[] r0 = src[y], r1 = src[y + 1];
            int rowOut = (y / 2) * hw;
            for (int x = 0; x < w; x += 2) {
                int a = r0[x], b = r0[x + 1];
                int c = r1[x], d = r1[x + 1];
                int l1 = (a + b) >> 1, h1 = a - b;
                int l2 = (c + d) >> 1, h2 = c - d;
                int o = rowOut + (x / 2);
                ps[o] = (l1 + l2) >> 1;
                pv[o] = l1 - l2;
                ph[o] = (h1 + h2) >> 1;
                pd[o] = h1 - h2;
            }
        }
    }

    /** Block inverse: quarters back into the plane. */
    public static void blockInverse(int[] ps, int[] pv, int[] ph, int[] pd,
            int hw, int hh, int[] dst) {
        int w = hw * 2;
        for (int y = 0; y < hh; y++) {
            for (int x = 0; x < hw; x++) {
                int o = y * hw + x;
                int[] v = inverse(ps[o], pv[o], ph[o], pd[o]);
                dst[(2 * y) * w + 2 * x] = v[0];
                dst[(2 * y) * w + 2 * x + 1] = v[1];
                dst[(2 * y + 1) * w + 2 * x] = v[2];
                dst[(2 * y + 1) * w + 2 * x + 1] = v[3];
            }
        }
    }
}
