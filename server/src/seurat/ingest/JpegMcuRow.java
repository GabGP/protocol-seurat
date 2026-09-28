package seurat.ingest;

/**
 * One MCU row of a JPEG from its coefficient blocks to packed RGB rows: IDCT per block, then the
 * same YCbCr conversion as libjpeg. Rows are independent, so several are painted at once after
 * the scan decoded them.
 */
final class JpegMcuRow {
    private static final int ID_R = 'R';
    private static final int ID_G = 'G';
    private static final int ID_B = 'B';

    private final JpegHeader j;
    private final int nc;
    private final int[] blocksPerRow;
    final int[][] coef;
    private final int[][] plane;
    private final int[] stride;
    private final int[] ws = new int[64];
    private final int[] samples;
    private final boolean rgb;

    JpegMcuRow(JpegHeader j, int[] blocksPerRow) {
        this.j = j;
        this.nc = j.id.length;
        this.blocksPerRow = blocksPerRow;
        this.coef = new int[nc][];
        this.plane = new int[nc][];
        this.stride = new int[nc];
        for (int c = 0; c < nc; c++) {
            stride[c] = blocksPerRow[c] * 8;
            coef[c] = new int[blocksPerRow[c] * j.v[c] * 64];
            plane[c] = new int[stride[c] * j.v[c] * 8];
        }
        this.samples = new int[j.width * nc];
        this.rgb = nc == 3 && (j.adobeTransform == 0
                || (j.adobeTransform < 0 && j.id[0] == ID_R && j.id[1] == ID_G && j.id[2] == ID_B));
    }

    /** Rows [0, rows) of this MCU row into {@code out[first..]} (components are full resolution). */
    void paint(int[][] out, int first, int rows) {
        for (int c = 0; c < nc; c++) {
            for (int by = 0; by < j.v[c]; by++) {
                for (int bx = 0; bx < blocksPerRow[c]; bx++) {
                    JpegIdct.idct(coef[c], (by * blocksPerRow[c] + bx) * 64, ws, plane[c],
                            by * 8 * stride[c] + bx * 8, stride[c]);
                }
            }
        }
        for (int y = 0; y < rows; y++) {
            emit(y, out[first + y]);
        }
    }

    private void emit(int y, int[] out) {
        int w = j.width;
        for (int c = 0; c < nc; c++) {
            int[] p = plane[c];
            int base = y * stride[c];
            for (int x = 0; x < w; x++) {
                samples[x * nc + c] = p[base + x];
            }
        }
        if (rgb) {
            for (int x = 0; x < w; x++) out[x] = samples[3 * x] << 16 | samples[3 * x + 1] << 8 | samples[3 * x + 2];
        } else {
            RasterRgb.row(samples, nc, out, w);
        }
    }
}
