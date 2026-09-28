package seurat.codec;

/** YCoCg-R exact reversible color. Y in [0,255], Co/Cg in [-255,255]. */
public final class YCoCgR {
    private YCoCgR() {}

    public static int[] forward(int r, int g, int b) {
        int co = r - b;
        int t = b + (co >> 1);
        int cg = g - t;
        return new int[]{t + (cg >> 1), co, cg};
    }

    public static int[] inverse(int y, int co, int cg) {
        int t = y - (cg >> 1);
        int g = cg + t;
        int b = t - (co >> 1);
        return new int[]{b + co, g, b};
    }

    /** Row of packed RGB to int16 Y/Co/Cg planes; the last pixel repeats up to {@code padded}. */
    public static void forwardRow(int[] rgb, short[] y, short[] co, short[] cg, int n, int padded) {
        for (int i = 0; i < n; i++) {
            int p = rgb[i];
            int r = (p >> 16) & 0xFF;
            int g = (p >> 8) & 0xFF;
            int b = p & 0xFF;
            int c_o = r - b;
            int t = b + (c_o >> 1);
            int c_g = g - t;
            y[i] = (short) (t + (c_g >> 1));
            co[i] = (short) c_o;
            cg[i] = (short) c_g;
        }
        for (int i = n; i < padded; i++) {
            y[i] = y[n - 1];
            co[i] = co[n - 1];
            cg[i] = cg[n - 1];
        }
    }
}
