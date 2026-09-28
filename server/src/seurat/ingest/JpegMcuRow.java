package seurat.ingest;

/**
 * One MCU row of a JPEG from its coefficient blocks to packed RGB rows: IDCT per block, each
 * component upsampled to full resolution ({@link JpegUpsample}), then the same YCbCr conversion as
 * libjpeg. The 2:1 vertical filter reads one component row of the MCU rows above and below, so a
 * row is emitted once its neighbours have been through the IDCT.
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
    /** Component rows per MCU row, upsampling factors, real samples per row and per column. */
    private final int[] rows;
    private final int[] sx;
    private final int[] sy;
    private final int[] dw;
    private final int[] dh;
    private final int[] mode;
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
        this.rows = new int[nc];
        this.sx = new int[nc];
        this.sy = new int[nc];
        this.dw = new int[nc];
        this.dh = new int[nc];
        this.mode = new int[nc];
        for (int c = 0; c < nc; c++) {
            stride[c] = blocksPerRow[c] * 8;
            rows[c] = j.v[c] * 8;
            coef[c] = new int[blocksPerRow[c] * j.v[c] * 64];
            plane[c] = new int[stride[c] * rows[c]];
            sx[c] = j.hMax / j.h[c];
            sy[c] = j.vMax / j.v[c];
            dw[c] = (j.width * j.h[c] + j.hMax - 1) / j.hMax;
            dh[c] = (j.height * j.v[c] + j.vMax - 1) / j.vMax;
            mode[c] = JpegUpsample.mode(sx[c], sy[c], dw[c]);
        }
        this.samples = new int[j.width * nc];
        this.rgb = nc == 3 && (j.adobeTransform == 0
                || (j.adobeTransform < 0 && j.id[0] == ID_R && j.id[1] == ID_G && j.id[2] == ID_B));
    }

    /** Coefficients to component samples, every block of the row. */
    void idct() {
        for (int c = 0; c < nc; c++) {
            for (int by = 0; by < j.v[c]; by++) {
                for (int bx = 0; bx < blocksPerRow[c]; bx++) {
                    JpegIdct.idct(coef[c], (by * blocksPerRow[c] + bx) * 64, ws, plane[c],
                            by * 8 * stride[c] + bx * 8, stride[c]);
                }
            }
        }
    }

    /** Image row {@code y} of this row, MCU row {@code m}; {@code prev}/{@code next} are null at the edges. */
    void emit(int m, int y, int[] out, JpegMcuRow prev, JpegMcuRow next) {
        int w = j.width;
        for (int c = 0; c < nc; c++) {
            int[] p = plane[c];
            switch (mode[c]) {
                case JpegUpsample.FULL -> JpegUpsample.box(p, y * stride[c], 1, w, samples, c, nc);
                case JpegUpsample.BOX -> JpegUpsample.box(p, y / sy[c] * stride[c], sx[c], w, samples, c, nc);
                case JpegUpsample.H2V1 -> JpegUpsample.h2v1(p, y * stride[c], dw[c], w, samples, c, nc);
                default -> {
                    int k = y >> 1;
                    int far = Math.max(0, Math.min(dh[c] - 1, m * rows[c] + k + ((y & 1) == 0 ? -1 : 1))) - m * rows[c];
                    int[] fp = far < 0 ? prev.plane[c] : far >= rows[c] ? next.plane[c] : p;
                    int fr = far < 0 ? rows[c] - 1 : far >= rows[c] ? 0 : far;
                    JpegUpsample.h2v2(p, k * stride[c], fp, fr * stride[c], dw[c], w, samples, c, nc);
                }
            }
        }
        if (rgb) {
            for (int x = 0; x < w; x++) out[x] = samples[3 * x] << 16 | samples[3 * x + 1] << 8 | samples[3 * x + 2];
        } else {
            RasterRgb.row(samples, nc, out, w);
        }
    }
}
