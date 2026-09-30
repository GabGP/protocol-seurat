package seurat.ingest.decode;

/**
 * JPEG YCbCr samples to packed RGB, one row at a time, with libjpeg's own fixed-point tables
 * (jdcolor.c), so every JPEG path gives the samples libjpeg would. Shared by all raster paths.
 */
public final class RasterRgb {
    private RasterRgb() {}

    private static final int SCALEBITS = 16;
    private static final int ONE_HALF = 1 << (SCALEBITS - 1);
    private static final int CENTER = 128;
    private static final int[] CR_R = new int[256];
    private static final int[] CB_B = new int[256];
    private static final int[] CR_G = new int[256];
    private static final int[] CB_G = new int[256];

    static {
        for (int i = 0; i < 256; i++) {
            int x = i - CENTER;
            CR_R[i] = (fix(1.40200) * x + ONE_HALF) >> SCALEBITS;
            CB_B[i] = (fix(1.77200) * x + ONE_HALF) >> SCALEBITS;
            CR_G[i] = -fix(0.71414) * x;
            CB_G[i] = -fix(0.34414) * x + ONE_HALF;
        }
    }

    private static int fix(double v) {
        return (int) (v * (1 << SCALEBITS) + 0.5);
    }

    public static void row(int[] samples, int bands, int[] rgb, int n) {
        if (bands >= 3) {
            for (int x = 0; x < n; x++) {
                int y = samples[x * bands];
                int cb = samples[x * bands + 1];
                int cr = samples[x * bands + 2];
                rgb[x] = Pixels.rgb(Pixels.clampByte(y + CR_R[cr]),
                        Pixels.clampByte(y + ((CB_G[cb] + CR_G[cr]) >> SCALEBITS)),
                        Pixels.clampByte(y + CB_B[cb]));
            }
        } else {
            for (int x = 0; x < n; x++) {
                int v = samples[x];
                rgb[x] = Pixels.gray(v);
            }
        }
    }
}
