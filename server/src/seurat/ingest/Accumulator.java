package seurat.ingest;

import seurat.codec.Geometry;

/** 256-row int16 accumulator for one stratum. Not thread-safe. */
final class Accumulator {
    final short[][][] plane = new short[3][][];
    final int width;
    int rows;

    Accumulator(int width) {
        this.width = width;
        for (int c = 0; c < 3; c++) {
            plane[c] = new short[Geometry.SIDE][width];
        }
    }

    /** Row {@code to} becomes a copy of row {@code from}. */
    void copyRow(int from, int to) {
        for (int c = 0; c < 3; c++) {
            System.arraycopy(plane[c][from], 0, plane[c][to], 0, width);
        }
        rows = Math.max(rows, to + 1);
    }

    void addRowDirect(int[] yy, int[] co, int[] cg, int srcOff, int w) {
        int y = rows;
        for (int x = 0; x < width; x++) {
            int sx = srcOff + Math.min(x, w - 1);
            plane[0][y][x] = (short) yy[sx];
            plane[1][y][x] = (short) co[sx];
            plane[2][y][x] = (short) cg[sx];
        }
        rows = y + 1;
    }

    void replicate() {
        while (rows > 0 && rows < Geometry.SIDE) {
            int src = rows - 1;
            for (int c = 0; c < 3; c++) {
                System.arraycopy(plane[c][src], 0, plane[c][rows], 0, width);
            }
            rows++;
        }
    }

    boolean full() {
        return rows >= Geometry.SIDE;
    }

    void clear() {
        rows = 0;
    }
}
