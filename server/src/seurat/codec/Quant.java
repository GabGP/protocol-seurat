package seurat.codec;

/**
 * Dead-zone quantization + per-stratum q table. qC=0 means no chroma refine.
 * Table 1 (stores without a "quant" marker): lossy s0-s2, 4:2:0 at s0, ~31 dB on pixel text.
 * Table 2: s1+ lossless, s0 q 2 with full chroma: every pixel within 4 levels of the master
 * (~52 dB), so zoomed-in pixels are exact to the eye while the master bytes never leave.
 */
public final class Quant {
    /** Table new stores are encoded with; IngestJob writes it beside the store. */
    public static final int TABLE = 2;

    /** First table whose strata above 0 are lossless (spec 2.2). */
    private static final int LOSSLESS_FROM = 2;
    /** q per stratum, the last entry covering every coarser one. Table 1 luma / chroma, table 2 luma / chroma. */
    private static final int[] Y_TABLE_1 = {6, 4, 2, 1};
    private static final int[] C_TABLE_1 = {0, 6, 3, 2};
    private static final int[] Y_TABLE_2 = {2, 1};
    private static final int[] C_TABLE_2 = {2, 1};

    private Quant() {}

    public static int quantize(int x, int q) {
        return q <= 0 ? 0 : x / q;
    }

    public static int dequantize(int i, int q) {
        if (i == 0 || q <= 0) {
            return 0;
        }
        int m = Math.abs(i) * q + q / 2;
        return i < 0 ? -m : m;
    }

    public static int qy(int stratum) {
        return qy(TABLE, stratum);
    }

    public static int qc(int stratum) {
        return qc(TABLE, stratum);
    }

    public static int qy(int table, int stratum) {
        return pick(table >= LOSSLESS_FROM ? Y_TABLE_2 : Y_TABLE_1, stratum);
    }

    public static int qc(int table, int stratum) {
        return pick(table >= LOSSLESS_FROM ? C_TABLE_2 : C_TABLE_1, stratum);
    }

    private static int pick(int[] q, int stratum) {
        return q[Math.min(Math.max(stratum, 0), q.length - 1)];
    }
}
