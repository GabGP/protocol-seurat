package seurat.ingest;

import seurat.codec.Geometry;

/** Geometry.HALF x Geometry.HALF windows over a brush row, edge-replicated. Sweep order. */
final class Window {
    private Window() {}

    static int[][] parents(int[][] ps, int w2, int bx) {
        int[][] out = new int[3][Geometry.PARENTS];
        for (int c = 0; c < 3; c++) {
            copy(ps[c], w2, bx, out[c]);
        }
        return out;
    }

    static int[][][] details(int[][] det, int w2, int bx) {
        int[][][] out = new int[det.length][1][Geometry.PARENTS];
        for (int c = 0; c < det.length; c++) {
            copy(det[c], w2, bx, out[c][0]);
        }
        return out;
    }

    static int[][][] details(int[][][] det, int w2, int bx) {
        int[][][] out = new int[det.length][1][Geometry.PARENTS];
        for (int c = 0; c < det.length; c++) {
            copy(det[c][0], w2, bx, out[c][0]);
        }
        return out;
    }

    /** The HALF columns of src (rows w2 wide) that start at brush column bx, the last column repeated past the edge. */
    private static void copy(int[] src, int w2, int bx, int[] dst) {
        for (int y = 0; y < Geometry.HALF; y++) {
            int srcY = y * w2;
            int dstY = y * Geometry.HALF;
            if ((bx + 1) * Geometry.HALF <= w2) {
                System.arraycopy(src, srcY + bx * Geometry.HALF, dst, dstY, Geometry.HALF);
            } else {
                for (int x = 0; x < Geometry.HALF; x++) {
                    dst[dstY + x] = src[srcY + Math.min(bx * Geometry.HALF + x, w2 - 1)];
                }
            }
        }
    }
}
