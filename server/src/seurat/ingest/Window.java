package seurat.ingest;

import seurat.codec.Geometry;

/** Geometry.HALFxGeometry.HALF windows over a brush row, edge-replicated. Sweep order. */
final class Window {
    private Window() {}

    static int[][] parents(int[][] ps, int w2, int bx) {
        int[][] out = new int[3][Geometry.PARENTS];
        for (int c = 0; c < 3; c++) {
            for (int y = 0; y < Geometry.HALF; y++) {
                int srcY = y * w2;
                int dstY = y * Geometry.HALF;
                if ((bx + 1) * Geometry.HALF <= w2) {
                    System.arraycopy(ps[c], srcY + bx * Geometry.HALF, out[c], dstY, Geometry.HALF);
                } else {
                    for (int x = 0; x < Geometry.HALF; x++) {
                        out[c][dstY + x] = ps[c][srcY + Math.min(bx * Geometry.HALF + x, w2 - 1)];
                    }
                }
            }
        }
        return out;
    }

    static int[][][] details(int[][] det, int w2, int bx) {
        int[][][] out = new int[det.length][1][Geometry.PARENTS];
        for (int c = 0; c < det.length; c++) {
            int[] dst = out[c][0];
            int[] src = det[c];
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
        return out;
    }

    static int[][][] details(int[][][] det, int w2, int bx) {
        int[][][] out = new int[det.length][1][Geometry.PARENTS];
        for (int c = 0; c < det.length; c++) {
            int[] dst = out[c][0];
            int[] src = det[c][0];
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
        return out;
    }
}
